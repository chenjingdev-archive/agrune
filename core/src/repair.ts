// Autonomous repair gate (§12.4) — the DETERMINISTIC core of the repair harness, the part the
// roadmap calls "the product." An LLM may PROPOSE new selectors for drifted targets (§12.4, B3b),
// but a proposal is published ONLY if it passes this gate. The invariant is mechanical, not
// aspirational: propose → verify → publish, NEVER guess → publish. A wrong manifest in the store is
// worse than no manifest (no manifest → safe a11y fallback; wrong manifest → confident wrong actions
// at scale), so the gate is the safety boundary.
//
// Two guarantees:
//   - PATCH, DON'T REWRITE. mergeManifestPatch replaces ONLY the selector of named targets; every
//     other target (and every other field of a patched target) stays byte-identical. Healthy targets
//     are frozen — a repair can never regress a working ref.
//   - VERIFY ON THE LIVE PAGE. A patch is eligible only if the merged manifest validates (schema +
//     forbidden-selector + keyFrom gates, §3.11) AND the patched target actually RESOLVES on the
//     live DOM (+ an optional effect oracle: act → onSuccess/expected delta). Failing patches are
//     dropped, not published.

import type { Page } from 'playwright'
import { validateManifest, type AgruneManifest, type ManifestTarget, type SelectorLadder } from './manifest.js'
import { resolveTargetLocator } from './resolver.js'

export interface TargetPatch {
  groupId: string
  targetId: string
  /** The proposed replacement selector ladder for this drifted target. */
  selector: SelectorLadder
}

/** Effect oracle: act on the freshly-resolved target and confirm the declared effect (§12.4). */
export type RepairOracle = (page: Page, target: ManifestTarget) => Promise<boolean>

export interface RepairVerdict {
  groupId: string
  targetId: string
  /** The patch referenced a target the base manifest actually declares. */
  matched: boolean
  /** The merged manifest passes validateManifest (schema/forbidden-selector/keyFrom). */
  validates: boolean
  /** The patched target resolves on the live page. */
  resolves: boolean
  /** Present only when an oracle was supplied. */
  oracleSatisfied?: boolean
  /** Eligible to publish = matched ∧ validates ∧ resolves ∧ (oracle ? oracleSatisfied : true). */
  eligible: boolean
  reason?: string
}

export interface RepairResult {
  /** base + ONLY the eligible patches — the manifest the harness would sign + publish. */
  merged: AgruneManifest
  verdicts: RepairVerdict[]
  eligible: TargetPatch[]
}

/** True iff the base manifest declares (groupId, targetId) as a direct group target. */
function declares(base: AgruneManifest, groupId: string, targetId: string): boolean {
  return base.groups.some((g) => g.groupId === groupId && g.targets.some((t) => t.targetId === targetId))
}

/**
 * Patch-merge: replace the `selector` of each named (groupId, targetId) target; FREEZE everything
 * else. Unpatched targets keep their original object reference, so they are byte-identical after the
 * merge — a repair cannot regress a working target.
 */
export function mergeManifestPatch(base: AgruneManifest, patches: TargetPatch[]): AgruneManifest {
  if (patches.length === 0) return base
  const byGroup = new Map<string, Map<string, SelectorLadder>>()
  for (const p of patches) {
    if (!byGroup.has(p.groupId)) byGroup.set(p.groupId, new Map())
    byGroup.get(p.groupId)!.set(p.targetId, p.selector)
  }
  return {
    ...base,
    groups: base.groups.map((group) => {
      const sel = byGroup.get(group.groupId)
      if (!sel) return group // frozen: same reference
      let touched = false
      const targets = group.targets.map((t) => {
        const newSelector = sel.get(t.targetId)
        if (!newSelector) return t // frozen
        touched = true
        return { ...t, selector: newSelector }
      })
      return touched ? { ...group, targets } : group
    }),
  }
}

/**
 * Verify proposed patches against the LIVE page. Returns the per-patch verdicts, the subset that is
 * eligible to publish, and the merged manifest containing ONLY those eligible patches. Each patch is
 * judged independently (merged onto base alone) so one bad proposal cannot disqualify a good one.
 */
export async function verifyRepair(
  page: Page,
  base: AgruneManifest,
  patches: TargetPatch[],
  opts: { oracle?: RepairOracle } = {},
): Promise<RepairResult> {
  const verdicts: RepairVerdict[] = []
  const eligible: TargetPatch[] = []

  for (const patch of patches) {
    const v: RepairVerdict = {
      groupId: patch.groupId,
      targetId: patch.targetId,
      matched: declares(base, patch.groupId, patch.targetId),
      validates: false,
      resolves: false,
      eligible: false,
    }
    if (!v.matched) {
      v.reason = 'target not declared in the base manifest (refusing to invent targets)'
      verdicts.push(v)
      continue
    }

    const mergedOne = mergeManifestPatch(base, [patch])
    const validated = validateManifest(mergedOne)
    v.validates = validated.ok
    if (!validated.ok) {
      v.reason = validated.errors[0]?.message ?? 'merged manifest failed validation'
      verdicts.push(v)
      continue
    }

    let resolvedTarget: ManifestTarget | undefined
    try {
      const locator = await resolveTargetLocator(page, patch.targetId, { manifestOverride: mergedOne })
      v.resolves = (await locator.count()) > 0
      resolvedTarget = validated.manifest.groups
        .find((g) => g.groupId === patch.groupId)
        ?.targets.find((t) => t.targetId === patch.targetId)
    } catch {
      v.resolves = false
    }
    if (!v.resolves) {
      v.reason = 'patched selector does not resolve on the live page'
      verdicts.push(v)
      continue
    }

    if (opts.oracle && resolvedTarget) {
      v.oracleSatisfied = await opts.oracle(page, resolvedTarget).catch(() => false)
      if (!v.oracleSatisfied) {
        v.reason = 'resolved but failed the effect oracle (onSuccess not observed)'
        verdicts.push(v)
        continue
      }
    }

    v.eligible = true
    verdicts.push(v)
    eligible.push(patch)
  }

  return { merged: mergeManifestPatch(base, eligible), verdicts, eligible }
}

// ---- orchestration loop (§12.4, B3b) ---------------------------------------
//
// The repair LOOP: propose → verify → (gate) → publish. The only non-deterministic step — proposing
// a new selector for a drifted target from its intent (the old target's name/role/desc) + the live
// a11y — is an INJECTED seam (`propose`), so an operator wires their agent/LLM there while the loop,
// the gate, and the publish decision stay deterministic and testable. The loop NEVER publishes a
// proposal that fails the gate: `publish` is invoked only with verified-eligible patches.

export interface DriftedTarget {
  groupId: string
  target: ManifestTarget
}

/** The LLM seam: given a drifted target's intent + the live a11y, propose a new selector (or give
 *  up with null). This is §8.1 self-heal's intent-matching escalated to screen scope by an LLM. */
export type ProposeSelector = (
  target: ManifestTarget,
  context: { groupId: string; ariaFallback: string },
) => Promise<SelectorLadder | null>

export interface RepairRequest {
  page: Page
  base: AgruneManifest
  drifted: DriftedTarget[]
  ariaFallback: string
  propose: ProposeSelector
  oracle?: RepairOracle
  /** Invoked ONLY when at least one patch passed the gate — with the verified merge + eligible set.
   *  The operator signs (signManifest) + publishes (publishToDir) here. Never called on a miss. */
  publish?: (merged: AgruneManifest, eligible: TargetPatch[]) => Promise<void>
}

export interface RepairOutcome {
  proposed: TargetPatch[]
  result: RepairResult
  /** True iff ≥1 proposal passed the gate (→ publish was invoked when provided). */
  publishable: boolean
}

export async function runRepair(req: RepairRequest): Promise<RepairOutcome> {
  const proposed: TargetPatch[] = []
  for (const d of req.drifted) {
    const selector = await req
      .propose(d.target, { groupId: d.groupId, ariaFallback: req.ariaFallback })
      .catch(() => null)
    if (selector) proposed.push({ groupId: d.groupId, targetId: d.target.targetId, selector })
  }

  const result = await verifyRepair(req.page, req.base, proposed, req.oracle ? { oracle: req.oracle } : {})
  const publishable = result.eligible.length > 0
  if (publishable && req.publish) await req.publish(result.merged, result.eligible)
  return { proposed, result, publishable }
}

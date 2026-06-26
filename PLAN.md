# agrune — Implementation Plan (open work)

Status board for the work surfaced through benching + the skill-creator eval loop. Two tracks:
**A. Quick fixes** (small, independent, parallelizable) and **B. The §12 manifest-lifecycle
roadmap** (large, sequential: store → ticket → repair). Each item lists problem, approach,
files, tests, risk, effort, dependencies.

Effort key: **S** ≈ ≤2h · **M** ≈ a day · **L** ≈ multi-day.

## STATUS — ALL SHIPPED ✅ (143 tests green; verify:no-internals green)

| Item | What | Commit |
|---|---|---|
| A1 | `scroll <ref>` verb | `b4d8238` |
| A2 | auto-spawn honors custom socket | `b4d8238` |
| A3 | skill description triggering | `bb0b2ef` |
| B1a | signed+pinned store client (adversarial-reviewed) | `8f1e446` |
| B1b | store wired into drift recovery | `23bbac4` |
| B2 | drift-ticket escalation | `0f259da` |
| B3 | repair gate + loop (propose→verify→publish) | `fe03fe6` |

The §12 sense → fetch → escalate → repair → verify → publish loop is now closed in code, with
the verification gate mechanical (a wrong proposal cannot be published). The original plans
below are kept as the design record.

---

---

## Sequencing (recommended)

1. **A1 scroll verb** · **A2 auto-spawn-socket** · **A3 description-opt** — independent quick wins, do first / in parallel.
2. **B1 manifest store (§12.2)** — backbone; everything downstream publishes to / reads from it.
3. **B2 ticket emission (§12.3)** — cheap once the store-miss trigger exists.
4. **B3 repair harness (§12.4)** — last; consumes B1+B2 and needs the verification scaffolding.

---

# Track A — Quick fixes

## A1. `agrune scroll <ref>` verb — reach offscreen targets

**Problem.** Eval found a control low in a tall dialog flagged `reason: offscreen`; `click`/`hover`
failed with Playwright "outside of the viewport" even after its own auto-scroll, and there is **no
scroll verb**. The agent worked around it with `agrune resize` — a hack the skill now documents
only because the real tool is missing. (`mousewheel` exists but is page-level wheel, not a
target-scoped scroll-into-view.)

**Approach.** Add `scroll <ref> [--to start|center|end|nearest]` → `locator.scrollIntoViewIfNeeded()`
(public API; default block `center`). Resolve the ref via the normal target resolver so it works
with manifest refs and repeat-rows. Keep it a thin wrapper (no custom DOM math).

**Files.**
- `src/registry.ts` — register `scroll` in the verb set (+ arg spec `--to`).
- `src/commands.ts` — `runScroll` → `POST /scroll { target, to }`.
- `src/daemon.ts` — `case 'POST /scroll'` → `session.scroll(...)`.
- `src/browser-session.ts` — `scroll(tabId, targetRef, to)` → resolve locator → `scrollIntoViewIfNeeded()` (or `evaluate(el => el.scrollIntoView({block:to}))` for the `--to` variants).
- `src/skill/SKILL.md` — replace the `resize` workaround in the `offscreen` note with `agrune scroll <ref>`.
- `SPEC.md` §5 action list + §6 parity table + A.2 command table.

**Tests.** Integration: a target below a short viewport → `inViewport:false`; `scroll` → re-read shows `inViewport:true` / action succeeds.

**Risk.** Low — public API only; `verify:no-internals` stays green.  **Effort.** S.  **Deps.** none.

---

## A2. Auto-spawn honors a custom `AGRUNE_DAEMON_SOCKET`

**Problem.** `getDaemonEndpoint` (`src/registry.ts:64-67`) returns `explicit: true` for
`AGRUNE_DAEMON_SOCKET`, lumping it with true-remote `--host/--port`. `DaemonClient` skips
auto-spawn when `explicit` (`src/session.ts:274`), so **every first command with a custom socket
fails `DAEMON_UNAVAILABLE`** until the user manually runs `agrune daemon start`. All 6 eval agents
hit this. A custom socket path is a *local per-workspace override*, not a remote endpoint — it
should auto-spawn like the default.

**Approach.**
- In `getDaemonEndpoint`, return `explicit: false` for the `AGRUNE_DAEMON_SOCKET` branch; keep
  `--host/--port` as `explicit: true` (those genuinely point at a daemon someone else manages).
- Ensure the auto-spawned `agrune daemon run` **listens on that same socket**: the child inherits
  env (so it re-reads `AGRUNE_DAEMON_SOCKET`), but verify `daemon run`'s own endpoint resolution
  uses it; if not, pass the socket explicitly in `daemonArgs` (`src/session.ts:196`).
- Confirm the spawn lock + session-file keying (`registry.ts` workspace run dir) don't collide
  when the socket is overridden (key the lock by socket path, not just cwd).

**Files.** `src/registry.ts` (endpoint branch), `src/session.ts` (ensureDaemon spawn — socket
propagation + lock key), possibly `src/daemon.ts` (daemon-run socket flag).

**Tests.** Integration: set `AGRUNE_DAEMON_SOCKET` to a temp path, run a fresh `open` → daemon
auto-spawns and binds that socket; no manual `daemon start`. (This also de-noises the bench/eval
harness, which sets custom sockets for isolation.)

**Risk.** Low-med — must get stale-socket cleanup + lock keying right.  **Effort.** S-M.  **Deps.** none.

---

## A3. Skill description trigger optimization

**Problem.** The `description` frontmatter is the primary triggering signal; it's unoptimized, and
with both `agrune` and `playwright` skills installed there's competition. Risk of under/mis-triggering.

**Approach.** Use skill-creator's loop (it exists, `claude -p`-backed):
1. Generate ~20 realistic trigger queries (8-10 should-trigger incl. casual/no-explicit-name; 8-10
   should-not near-misses — esp. "automate a browser" cases where playwright-test is wanted instead).
2. User review via the skill-creator HTML template.
3. `python -m scripts.run_loop --eval-set <q.json> --skill-path src/skill --model claude-opus-4-8 --max-iterations 5`.
4. Apply `best_description` (chosen by held-out test score) to SKILL.md frontmatter; show before/after.

**Files.** `src/skill/SKILL.md` (frontmatter `description` only). Workspace under scratchpad.

**Tests.** The loop's own train/held-out trigger-rate report.

**Risk.** Low — description-only change.  **Effort.** S (mostly automated).  **Deps.** none (do after A-fixes land so the skill body is stable).

---

# Track B — Manifest lifecycle (§12 roadmap)

> The §8.7 drift sensor is built (regress-from-baseline). B1-B3 are the recovery loop on top of it.
> **Non-negotiable invariant for the whole track: `propose → verify → publish`, never `guess →
> publish`. A wrong manifest in the store is worse than no manifest** (no manifest → safe a11y
> fallback; wrong manifest → confident wrong actions at scale).

## B1. Manifest store + fetch-latest (§12.2) — the backbone

**Goal.** Manifest source becomes pluggable (`page-injected | store-fetched | local-file`); on
confirmed drift, agrune fetches the latest signed manifest for this app and swaps it in. Built
FIRST — B3 publishes here, B2's miss is the trigger.

**Approach.**
- **Source chain.** Today `loadManifestFromPage` (`src/resolver.ts`) reads
  `window.__agrune_manifest__`. Introduce a `resolveManifest(page, cfg)` that tries, in order:
  store-override-on-drift → page-injected (default primary) → local file. Precedence configurable.
- **Addressing.** Key by `(origin, appVersionOrContentHash, schemaVersion)`. Cheap version probe
  via ETag / content-hash before a full fetch; full fetch only on drift or version mismatch.
- **Store client** (`src/manifest-store.ts`, new): `GET` against a configured store
  (`AGRUNE_MANIFEST_STORE` URL; start with plain HTTPS+JSON, leave room for OCI/git later). Local
  cache dir keyed by `(origin, hash)`.
- **SECURITY (load-bearing).** `keyFrom` compiles via `new Function` (§3.11.4) → a remote manifest
  is a code-injection surface. Store artifacts MUST be **signed (ed25519/minisign) + pinned**
  (`AGRUNE_MANIFEST_STORE_KEY`); unsigned/unpinned → rejected, never executed. keyFrom stays
  compile-gated regardless.
- **Wiring.** `driftCheck` confirms drift → attempt store fetch-latest → if a newer *signed*
  manifest exists, swap + `refreshSnapshot` + re-resolve (drift resolves itself); else leave drift
  surfaced → hands off to B2.

**Files.** new `src/manifest-store.ts` (fetch + verify + cache), `src/resolver.ts` (source chain),
`src/browser-session.ts` (driftCheck → store attempt), `src/plugins/config.ts`
(`AGRUNE_MANIFEST_STORE`, `_KEY`, precedence). `SPEC.md` §12.2.

**Tests.** Unit: source-precedence resolution; signature verify (good/bad/unsigned). Integration:
drift → store serves a fixed manifest → swapped in → drift clears.

**Risk.** **HIGH** — signing scheme, source precedence, cache invalidation.  **Effort.** L.
**Open Qs.** store protocol (HTTPS+JSON+sig vs OCI vs git); signing scheme; how the *app version /
content hash* is derived (page-provided meta? URL? DOM hash?).

## B2. Ticket emission (§12.3) — escalate a store miss

**Goal.** Drift confirmed AND store fetch missed (no fresh manifest) → emit a durable ticket to an
ops sink so a human/agent fixes it, while the runtime keeps working degraded (a11y fallback).

**Approach.**
- **Payload** ≈ 90% the §8.7 `DriftReport` (group, no-longer-resolving targetIds, baseline,
  captured a11y) + screenshot + url + appVersion + fingerprint. Cheap — the sensor already built it.
- **Dedup** by fingerprint `hash(origin, groupId, sorted(missingTargetIds))` → repeated drift = one
  OPEN ticket, not one-per-load (track open fingerprints in a local state file and/or via sink API).
- **Debounce** — emit only after drift is CONFIRMED across N reads / M seconds (the §8.7 per-call
  signal is right for the inline a11y fallback but too twitchy for escalation).
- **Sink pluggable** — GitHub issue (`gh api`) | Linear | generic webhook (`AGRUNE_TICKET_SINK` + creds).

**Files.** new `src/ticket.ts` (payload build + dedup + debounce + sink adapters),
`src/browser-session.ts` (on drift+store-miss → ticket), `src/plugins/config.ts`. `SPEC.md` §12.3.

**Tests.** Unit: fingerprint dedup; debounce window; payload shape. Integration: forced drift +
no-store → one ticket via a stub webhook; repeated drift → still one.

**Risk.** MED — dedup/debounce correctness, sink auth, anti-spam.  **Effort.** M.  **Deps.** B1 (store-miss is the trigger), §8.7 (done).

## B3. Autonomous repair harness (§12.4) — close the loop

**Goal.** Ticket → an agent re-authors the *drifted targets only* → verifies → publishes a signed
manifest to the store. Next run pulls the repaired manifest.

**Approach.**
- **Trigger** off an open ticket. **Inputs already produced by the runtime:** the live a11y
  (drift fallback), the OLD manifest target as the *intent spec* (name/desc/role — "find what now
  does what 'Filter' used to do"), and the target's `onSuccess` as a *test oracle*.
- **Patch, don't rewrite.** Healthy targets FROZEN; only drifted targets get new selector ladders
  (diff-based; must not regress working refs). This is §8.1 self-heal's intent-matching escalated
  from target-scope to screen-scope by an LLM.
- **VERIFICATION GATE (first-class).** A repaired target is published only if it (a) passes schema
  + forbidden-selector + keyFrom gates (`validateManifest`), AND (b) resolves on the live page +
  satisfies its effect oracle (act → `onSuccess`/expected snapshot delta). Failing targets are NOT
  published — they stay as open ticket items.
- **Provenance + rollback.** Each store version records author (`agent`|`human`), timestamp, target
  appVersion; one-click rollback. Treat as infra config.
- **Form factor.** Likely a Workflow (orchestrated: per-drifted-target propose → verify in
  parallel → synthesize patch) or a standalone harness script; reuses `validateManifest`,
  self-heal scoring (as a candidate hint), and `browser-session` for verify-by-acting.

**Files.** new harness (e.g. `tools/repair/` or a Workflow script), reuse `src/manifest.ts`
(`validateManifest`), `src/plugins/self-heal.ts` (scoring), `src/browser-session.ts` (act+verify),
`src/manifest-store.ts` (publish). `SPEC.md` §12.4.

**Tests.** Unit: patch-merge keeps healthy targets byte-identical. Integration: drift a fixture
app → harness proposes new selectors → verify gate → publish to a stub store → re-open resolves
clean. Adversarial: a wrong proposal must FAIL the oracle and not publish.

**Risk.** **HIGH** — a wrong published manifest is worse than none; verification rigor is the
product. Non-determinism.  **Effort.** L.  **Deps.** B1 (publish target) + B2 (trigger) + §8.7 (done).

---

## Also-noted (not yet scoped into a track)

- **`evaluate` single-expression constraint** — surfaced in eval (statements rejected). Either
  accept statement bodies (wrap in a function) or just keep the SKILL note (done). Low priority.
- **`read` is full-page innerText** — SKILL note added; consider a `--target` scope for `read`
  (parity with `snapshot --target`). Low priority.

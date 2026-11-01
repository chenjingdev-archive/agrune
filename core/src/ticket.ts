// Drift-ticket emission (§12.3) — Tier-3 escalation. When drift is CONFIRMED and store recovery
// MISSED (no fresh trusted manifest, §12.2), the runtime keeps working degraded (a11y fallback)
// while a durable ticket is filed to an ops sink so a human/agent can repair the manifest (§12.4).
//
// Two properties keep this from becoming spam:
//   - DEDUP by fingerprint(origin, groupId, sorted missingTargetIds): the same breakage filed once,
//     not once per page load.
//   - DEBOUNCE: emit only after the breakage is observed N times across an M-ms window. The §8.6
//     per-call drift signal is right for the inline a11y fallback but too twitchy for escalation.
//
// The sink is pluggable (file JSONL | webhook) and best-effort: a sink failure NEVER breaks the run
// and is retried (with a cooldown) on a later drift observation. This module is pure + injectable so
// the dedup/debounce logic is unit-testable with a fake clock and an in-memory sink.

import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import http from 'node:http'
import https from 'node:https'

export interface DriftTicketInput {
  origin: string
  url: string
  groupId: string
  groupName?: string
  missingTargetIds: string[]
  baseline: number
  resolved: number
  total: number
  /** The a11y escape-hatch snapshot captured on drift — the repair agent's primary input (§12.4). */
  ariaFallback?: string
}

export interface EmittedTicket extends DriftTicketInput {
  fingerprint: string
  observations: number
  firstSeenMs: number
  emittedAtMs: number
}

export type TicketSink = (ticket: EmittedTicket) => Promise<void>

/** Stable identity of a breakage: same (origin, group, set-of-missing-targets) → one OPEN ticket. */
export function fingerprintFor(origin: string, groupId: string, missingTargetIds: string[]): string {
  const norm = [...missingTargetIds].sort().join(',')
  return createHash('sha256').update(`${origin}\t${groupId}\t${norm}`).digest('hex').slice(0, 16)
}

// ---- config ----------------------------------------------------------------

export interface TicketConfig {
  enabled: boolean
  sinkSpec?: string
  minObservations: number
  minWindowMs: number
}

function intEnv(v: string | undefined, def: number, min: number, max: number): number {
  if (v === undefined || v.trim() === '') return def
  const n = Number(v)
  if (!Number.isFinite(n)) return def
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function loadTicketConfig(env: NodeJS.ProcessEnv = process.env): TicketConfig {
  const sinkSpec = env.AGRUNE_TICKET_SINK?.trim()
  return {
    enabled: Boolean(sinkSpec),
    ...(sinkSpec ? { sinkSpec } : {}),
    minObservations: intEnv(env.AGRUNE_TICKET_MIN_OBS, 2, 1, 1000),
    minWindowMs: intEnv(env.AGRUNE_TICKET_MIN_WINDOW_MS, 1500, 0, 3_600_000),
  }
}

// ---- sinks (pluggable) -----------------------------------------------------

function fileSink(path: string): TicketSink {
  return async (ticket) => {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(ticket) + '\n')
  }
}

function webhookSink(url: string): TicketSink {
  return (ticket) =>
    new Promise<void>((resolve, reject) => {
      const body = JSON.stringify(ticket)
      const mod = url.startsWith('http://') ? http : https
      const req = mod.request(
        url,
        { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
        (res) => {
          res.resume() // drain
          res.on('end', () =>
            res.statusCode && res.statusCode >= 200 && res.statusCode < 300
              ? resolve()
              : reject(new Error(`ticket sink HTTP ${res.statusCode}`)),
          )
        },
      )
      req.on('error', reject)
      req.setTimeout(5000, () => req.destroy(new Error('ticket sink timeout')))
      req.write(body)
      req.end()
    })
}

/**
 * Build a sink from `AGRUNE_TICKET_SINK`:
 *   - `file:/abs/path.jsonl` → append one JSON line per ticket (default/dev sink).
 *   - `http(s)://…` → POST the ticket JSON (generic webhook → GitHub/Linear/Slack via a relay).
 * Unknown spec → null (caller disables + warns). GitHub/Linear native adapters slot in here later.
 */
export function makeSink(spec: string): TicketSink | null {
  if (spec.startsWith('file:')) return fileSink(spec.slice('file:'.length))
  if (spec.startsWith('http://') || spec.startsWith('https://')) return webhookSink(spec)
  return null
}

// ---- emitter (dedup + debounce) --------------------------------------------

interface ObsState {
  observations: number
  firstSeenMs: number
  emitted: boolean
  lastAttemptMs?: number
}

const RETRY_COOLDOWN_MS = 60_000

export class TicketEmitter {
  private readonly state = new Map<string, ObsState>()

  constructor(
    private readonly cfg: TicketConfig,
    private readonly sink: TicketSink,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Record one confirmed-drift-with-store-miss observation. Emits (at most once per fingerprint,
   * subject to retry-on-failure with a cooldown) when the debounce threshold is met. Returns the
   * emitted ticket on success, else null. Never throws — escalation must not break the run.
   */
  async observe(input: DriftTicketInput): Promise<EmittedTicket | null> {
    const fingerprint = fingerprintFor(input.origin, input.groupId, input.missingTargetIds)
    const now = this.now()
    const st: ObsState = this.state.get(fingerprint) ?? { observations: 0, firstSeenMs: now, emitted: false }
    st.observations += 1
    this.state.set(fingerprint, st)

    if (st.emitted) return null
    if (st.observations < this.cfg.minObservations) return null
    if (now - st.firstSeenMs < this.cfg.minWindowMs) return null
    if (st.lastAttemptMs !== undefined && now - st.lastAttemptMs < RETRY_COOLDOWN_MS) return null

    st.lastAttemptMs = now
    const ticket: EmittedTicket = {
      ...input,
      fingerprint,
      observations: st.observations,
      firstSeenMs: st.firstSeenMs,
      emittedAtMs: now,
    }
    try {
      await this.sink(ticket)
      st.emitted = true
      return ticket
    } catch {
      // Sink failed — leave unemitted so a later drift observation retries after the cooldown.
      return null
    }
  }
}

// Drift-ticket emission (§12.3, B2) — dedup + debounce. A fake clock + in-memory sink make the
// escalation logic deterministic: the same breakage files ONE ticket (not one per load), and only
// after it has been confirmed enough times across a window.

import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  TicketEmitter,
  fingerprintFor,
  loadTicketConfig,
  makeSink,
  type EmittedTicket,
  type DriftTicketInput,
} from '../src/ticket.js'

const INPUT: DriftTicketInput = {
  origin: 'https://app.test',
  url: 'https://app.test/board',
  groupId: 'board',
  missingTargetIds: ['b', 'c', 'd'],
  baseline: 4,
  resolved: 1,
  total: 4,
  ariaFallback: '- button "A"',
}

function fakeClock(start = 1000) {
  let t = start
  return { now: () => t, advance: (ms: number) => (t += ms) }
}

function captureSink() {
  const sent: EmittedTicket[] = []
  return { sink: async (tk: EmittedTicket) => void sent.push(tk), sent }
}

describe('B2 — fingerprint identity', () => {
  it('is stable regardless of missing-id order; differs by group/origin', () => {
    const a = fingerprintFor('https://app.test', 'board', ['b', 'c', 'd'])
    const b = fingerprintFor('https://app.test', 'board', ['d', 'b', 'c'])
    expect(a).toBe(b)
    expect(fingerprintFor('https://app.test', 'list', ['b', 'c', 'd'])).not.toBe(a)
    expect(fingerprintFor('https://other.test', 'board', ['b', 'c', 'd'])).not.toBe(a)
  })
})

describe('B2 — debounce', () => {
  it('does NOT emit on the first observation (twitchy single-read suppressed)', async () => {
    const clock = fakeClock()
    const { sink, sent } = captureSink()
    const e = new TicketEmitter({ enabled: true, minObservations: 2, minWindowMs: 1000 }, sink, clock.now)
    expect(await e.observe(INPUT)).toBeNull()
    expect(sent).toHaveLength(0)
  })

  it('emits once the observation count AND the time window are both satisfied', async () => {
    const clock = fakeClock()
    const { sink, sent } = captureSink()
    const e = new TicketEmitter({ enabled: true, minObservations: 2, minWindowMs: 1000 }, sink, clock.now)
    expect(await e.observe(INPUT)).toBeNull() // obs 1
    clock.advance(1500)
    const tk = await e.observe(INPUT) // obs 2, window passed
    expect(tk).not.toBeNull()
    expect(sent).toHaveLength(1)
    expect(tk!.fingerprint).toBe(fingerprintFor(INPUT.origin, INPUT.groupId, INPUT.missingTargetIds))
    expect(tk!.observations).toBe(2)
  })

  it('holds emission until the window elapses even with enough observations', async () => {
    const clock = fakeClock()
    const { sink, sent } = captureSink()
    const e = new TicketEmitter({ enabled: true, minObservations: 2, minWindowMs: 5000 }, sink, clock.now)
    await e.observe(INPUT)
    clock.advance(100)
    expect(await e.observe(INPUT)).toBeNull() // count ok, window not yet
    clock.advance(6000)
    expect(await e.observe(INPUT)).not.toBeNull()
    expect(sent).toHaveLength(1)
  })
})

describe('B2 — dedup', () => {
  it('files the SAME breakage only once, no matter how many further reads', async () => {
    const clock = fakeClock()
    const { sink, sent } = captureSink()
    const e = new TicketEmitter({ enabled: true, minObservations: 1, minWindowMs: 0 }, sink, clock.now)
    for (let i = 0; i < 5; i++) {
      clock.advance(100)
      await e.observe(INPUT)
    }
    expect(sent).toHaveLength(1)
  })

  it('a DIFFERENT breakage (new missing set) files its own ticket', async () => {
    const clock = fakeClock()
    const { sink, sent } = captureSink()
    const e = new TicketEmitter({ enabled: true, minObservations: 1, minWindowMs: 0 }, sink, clock.now)
    await e.observe(INPUT)
    await e.observe({ ...INPUT, missingTargetIds: ['x', 'y'] })
    expect(sent).toHaveLength(2)
  })
})

describe('B2 — sink robustness', () => {
  it('a sink failure does not throw and leaves the ticket unemitted (retries after cooldown)', async () => {
    const clock = fakeClock()
    let calls = 0
    const flaky = async () => {
      calls += 1
      if (calls === 1) throw new Error('sink down')
    }
    const e = new TicketEmitter({ enabled: true, minObservations: 1, minWindowMs: 0 }, flaky, clock.now)
    expect(await e.observe(INPUT)).toBeNull() // first attempt fails
    clock.advance(61_000) // past the retry cooldown
    expect(await e.observe(INPUT)).not.toBeNull() // retried and succeeded
    expect(calls).toBe(2)
  })

  it('does not hammer a broken sink within the cooldown', async () => {
    const clock = fakeClock()
    let calls = 0
    const broken = async () => {
      calls += 1
      throw new Error('always down')
    }
    const e = new TicketEmitter({ enabled: true, minObservations: 1, minWindowMs: 0 }, broken, clock.now)
    await e.observe(INPUT)
    clock.advance(1000) // within cooldown
    await e.observe(INPUT)
    expect(calls).toBe(1) // second attempt suppressed by cooldown
  })
})

describe('B2 — config + sinks', () => {
  it('loadTicketConfig: enabled only with a sink spec; clamps obs/window', () => {
    const cfg = loadTicketConfig({ AGRUNE_TICKET_SINK: 'file:/tmp/t.jsonl', AGRUNE_TICKET_MIN_OBS: '3' } as NodeJS.ProcessEnv)
    expect(cfg.enabled).toBe(true)
    expect(cfg.sinkSpec).toBe('file:/tmp/t.jsonl')
    expect(cfg.minObservations).toBe(3)
    expect(loadTicketConfig({} as NodeJS.ProcessEnv).enabled).toBe(false)
  })

  it('makeSink: file sink appends JSONL; unknown spec → null', async () => {
    expect(makeSink('weird:thing')).toBeNull()
    const dir = mkdtempSync(join(tmpdir(), 'agrune-tix-'))
    try {
      const path = join(dir, 'nested', 'tickets.jsonl')
      const sink = makeSink(`file:${path}`)!
      const tk: EmittedTicket = { ...INPUT, fingerprint: 'fp', observations: 2, firstSeenMs: 1, emittedAtMs: 2 }
      await sink(tk)
      await sink(tk)
      expect(existsSync(path)).toBe(true)
      const lines = readFileSync(path, 'utf8').trim().split('\n')
      expect(lines).toHaveLength(2)
      expect(JSON.parse(lines[0]!).groupId).toBe('board')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

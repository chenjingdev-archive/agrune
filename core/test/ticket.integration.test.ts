// Real-chromium drift-ticket test (§12.3, B2). With no store configured, a confirmed drift is a
// store-MISS, so the daemon escalates a ticket to the configured sink. The emitter debounces (no
// ticket on the first drift read) and dedups (one ticket for the same breakage, not one per read).

import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon, type DaemonHandle } from '../src/daemon.js'
import { requestJson } from '../src/session.js'

const MANIFEST = {
  version: 3,
  groups: [
    {
      groupId: 'board',
      name: 'Board',
      targets: [
        { targetId: 'a', name: 'A', selector: { css: '#a' }, actionKinds: ['click'] },
        { targetId: 'b', name: 'B', selector: { css: '#b' }, actionKinds: ['click'] },
        { targetId: 'c', name: 'C', selector: { css: '#c' }, actionKinds: ['click'] },
        { targetId: 'd', name: 'D', selector: { css: '#d' }, actionKinds: ['click'] },
      ],
    },
  ],
}
const HTML = `<!doctype html><title>TK</title>
<button id="a">A</button><button id="b">B</button><button id="c">C</button><button id="d">D</button>
<script>window.__agrune_manifest__=${JSON.stringify(MANIFEST)}</script>`
const BREAK = `() => { for (const id of ['b','c','d']) document.getElementById(id)?.remove() }`

describe('B2 — drift ticket on store miss (§12.3, real chromium)', () => {
  it('debounces then files exactly ONE ticket for a repeated breakage', async () => {
    const pageServer = http.createServer((_r, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(HTML)
    })
    await new Promise<void>((r) => pageServer.listen(0, '127.0.0.1', () => r()))
    const port = (pageServer.address() as { port: number }).port
    const pageUrl = `http://127.0.0.1:${port}/`

    const dir = mkdtempSync(join(tmpdir(), 'agrune-tix-int-'))
    const ticketPath = join(dir, 'tickets.jsonl')
    const endpoint = `unix:${join(dir, 'd.sock')}`

    const saved = { ...process.env }
    process.env.AGRUNE_TICKET_SINK = `file:${ticketPath}`
    process.env.AGRUNE_TICKET_MIN_OBS = '2'
    process.env.AGRUNE_TICKET_MIN_WINDOW_MS = '0'
    // Ensure no store is configured → drift is a store miss → escalation path.
    delete process.env.AGRUNE_MANIFEST_STORE
    delete process.env.AGRUNE_MANIFEST_STORE_KEY

    let handle: DaemonHandle | null = null
    const get = (p: string) => requestJson(endpoint, 'GET', p) as Promise<any>
    const post = (p: string, b: Record<string, unknown>) => requestJson(endpoint, 'POST', p, b)
    try {
      handle = await startDaemon({ endpoint, headless: true })
      await post('/open', { url: pageUrl })

      const healthy = await get('/targets')
      if (healthy.drift) return // env hiccup
      expect(healthy.drift).toBeUndefined()

      await post('/evaluate', { source: BREAK })

      // First drift read: debounced (no ticket yet).
      const first = await get('/targets')
      expect(first.drift?.drifted).toBe(true)
      expect(existsSync(ticketPath)).toBe(false)

      // Second + third drift reads: ticket fires once, then dedups.
      await get('/targets')
      await get('/targets')

      expect(existsSync(ticketPath)).toBe(true)
      const lines = readFileSync(ticketPath, 'utf8').trim().split('\n').filter(Boolean)
      expect(lines).toHaveLength(1)
      const ticket = JSON.parse(lines[0]!)
      expect(ticket.groupId).toBe('board')
      expect(ticket.missingTargetIds.sort()).toEqual(['b', 'c', 'd'])
      expect(ticket.baseline).toBe(4)
      expect(typeof ticket.fingerprint).toBe('string')
      expect(typeof ticket.ariaFallback).toBe('string')
    } finally {
      await handle?.close()
      await new Promise<void>((r) => pageServer.close(() => r()))
      rmSync(dir, { recursive: true, force: true })
      for (const k of ['AGRUNE_TICKET_SINK', 'AGRUNE_TICKET_MIN_OBS', 'AGRUNE_TICKET_MIN_WINDOW_MS']) {
        if (saved[k] === undefined) delete process.env[k]
        else process.env[k] = saved[k]
      }
    }
  })
})

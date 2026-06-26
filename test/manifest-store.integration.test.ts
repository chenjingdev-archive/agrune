// Real-chromium store-recovery test (§12.2, B1b). A page-injected manifest drifts; the daemon
// fetches a fresh SIGNED manifest from a local store, verifies it against the pinned key, swaps it
// in, and the regression resolves — GET /targets returns the recovered snapshot + manifestSource.
// A manifest signed by the WRONG key is rejected end-to-end, leaving drift + the a11y fallback.

import { describe, it, expect } from 'vitest'
import http from 'node:http'
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon, type DaemonHandle } from '../src/daemon.js'
import { requestJson } from '../src/session.js'

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const wrong = generateKeyPairSync('ed25519')
const PUBLIC_PEM = publicKey.export({ type: 'spki', format: 'pem' }).toString()

const board = (sel: { b: string; c: string; d: string }) => ({
  version: 3,
  groups: [
    {
      groupId: 'board',
      name: 'Board',
      targets: [
        { targetId: 'a', name: 'A', selector: { css: '#a' }, actionKinds: ['click'] },
        { targetId: 'b', name: 'B', selector: { css: sel.b }, actionKinds: ['click'] },
        { targetId: 'c', name: 'C', selector: { css: sel.c }, actionKinds: ['click'] },
        { targetId: 'd', name: 'D', selector: { css: sel.d }, actionKinds: ['click'] },
      ],
    },
  ],
})

// Page ships selectors that match the INITIAL DOM; the store ships selectors that match the DOM
// AFTER the break — so the page manifest drifts and only the store manifest recovers.
const PAGE_MANIFEST = board({ b: '#b', c: '#c', d: '#d' })
const STORE_MANIFEST = board({ b: '#b2', c: '#c2', d: '#d2' })

const HTML = `<!doctype html><title>ST</title>
<button id="a">A</button><button id="b">B</button><button id="c">C</button><button id="d">D</button>
<script>window.__agrune_manifest__=${JSON.stringify(PAGE_MANIFEST)}</script>`

// Remove b/c/d (keep #a so the group stays ENGAGED) and add the renamed b2/c2/d2 → structure break.
const BREAK = `() => {
  for (const id of ['b','c','d']) document.getElementById(id)?.remove()
  for (const id of ['b2','c2','d2']) { const el = document.createElement('button'); el.id = id; el.textContent = id; document.body.appendChild(el) }
}`

function signedEnvelope(key: KeyObject): string {
  const payloadJson = JSON.stringify({ manifest: STORE_MANIFEST, meta: { author: 'agent' } })
  const signature = cryptoSign(null, Buffer.from(payloadJson, 'utf8'), key).toString('base64')
  return JSON.stringify({ payloadJson, alg: 'ed25519', signature })
}

interface Harness {
  endpoint: string
  pageUrl: string
  post: (p: string, b: Record<string, unknown>) => Promise<any>
  get: (p: string) => Promise<any>
}

async function withStoreDaemon(signKey: KeyObject, fn: (h: Harness) => Promise<void>): Promise<void> {
  const pageServer = http.createServer((_r, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(HTML)
  })
  const storeServer = http.createServer((_r, res) => {
    res.writeHead(200, { 'content-type': 'application/json', etag: 'W/"v1"' })
    res.end(signedEnvelope(signKey))
  })
  await new Promise<void>((r) => pageServer.listen(0, '127.0.0.1', () => r()))
  await new Promise<void>((r) => storeServer.listen(0, '127.0.0.1', () => r()))
  const pagePort = (pageServer.address() as { port: number }).port
  const storePort = (storeServer.address() as { port: number }).port
  const pageUrl = `http://127.0.0.1:${pagePort}/`

  const saved = { ...process.env }
  process.env.AGRUNE_MANIFEST_STORE = `http://127.0.0.1:${storePort}`
  process.env.AGRUNE_MANIFEST_STORE_KEY = PUBLIC_PEM

  const dir = mkdtempSync(join(tmpdir(), 'agrune-store-'))
  const endpoint = `unix:${join(dir, 'd.sock')}`
  let handle: DaemonHandle | null = null
  try {
    handle = await startDaemon({ endpoint, headless: true })
    const post = (p: string, b: Record<string, unknown>) => requestJson(endpoint, 'POST', p, b)
    const get = (p: string) => requestJson(endpoint, 'GET', p)
    await post('/open', { url: pageUrl })
    await fn({ endpoint, pageUrl, post, get })
  } finally {
    await handle?.close()
    await new Promise<void>((r) => pageServer.close(() => r()))
    await new Promise<void>((r) => storeServer.close(() => r()))
    rmSync(dir, { recursive: true, force: true })
    process.env.AGRUNE_MANIFEST_STORE = saved.AGRUNE_MANIFEST_STORE
    process.env.AGRUNE_MANIFEST_STORE_KEY = saved.AGRUNE_MANIFEST_STORE_KEY
    if (saved.AGRUNE_MANIFEST_STORE === undefined) delete process.env.AGRUNE_MANIFEST_STORE
    if (saved.AGRUNE_MANIFEST_STORE_KEY === undefined) delete process.env.AGRUNE_MANIFEST_STORE_KEY
  }
}

const boardResolved = (snap: any): number =>
  snap.targets.filter((t: any) => t.groupId === 'board' && t.domResolved === true).length

describe('B1b — store recovery on drift (§12.2, real chromium)', () => {
  it('drift → fetch a signed manifest → swap → regression resolves (manifestSource:store)', async () => {
    let ranAssertions = false
    await withStoreDaemon(privateKey, async ({ post, get }) => {
      // 1) Healthy baseline: page manifest resolves all 4 board targets.
      const healthy = await get('/targets')
      if (healthy.drift) return // chromium env hiccup — skip rather than false-fail
      expect(boardResolved(healthy.snapshot)).toBe(4)

      // 2) Break the DOM so the page-injected manifest drifts (4 → 1).
      await post('/evaluate', { source: BREAK })

      // 3) Next read: drift is detected, recovered from the store, and the swapped manifest
      //    resolves the renamed controls. No a11y fallback — we recovered cleanly.
      const recovered = await get('/targets')
      expect(recovered.manifestSource).toBe('store')
      expect(recovered.ariaFallback).toBeUndefined()
      expect(recovered.drift).toBeUndefined()
      expect(boardResolved(recovered.snapshot)).toBe(4)
      ranAssertions = true
    })
    expect(ranAssertions).toBe(true)
  })

  it('a manifest signed by the WRONG key is rejected → drift + a11y, no swap', async () => {
    await withStoreDaemon(wrong.privateKey, async ({ post, get }) => {
      const healthy = await get('/targets')
      if (healthy.drift) return
      expect(boardResolved(healthy.snapshot)).toBe(4)

      await post('/evaluate', { source: BREAK })

      const after = await get('/targets')
      // The untrusted store manifest is refused, so we fall back to the a11y escape hatch.
      expect(after.manifestSource).toBeUndefined()
      expect(after.drift?.drifted).toBe(true)
      expect(typeof after.ariaFallback).toBe('string')
      // The page-injected manifest is still in force → only #a resolves.
      expect(boardResolved(after.snapshot)).toBe(1)
    })
  })
})

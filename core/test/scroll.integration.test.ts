// Real-chromium test for the `scroll` verb (§6.5, A1). A target far below a short viewport reads
// `inViewport:false`; `scroll` brings it into view so the next read flips it to `inViewport:true`.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon, type DaemonHandle } from '../src/daemon.js'
import { requestJson } from '../src/session.js'

const MANIFEST = {
  version: 3,
  groups: [
    {
      groupId: 'g',
      name: 'G',
      targets: [
        { targetId: 'top', name: 'Top', selector: { css: '#top' }, actionKinds: ['click'] },
        { targetId: 'far', name: 'Far', selector: { css: '#far' }, actionKinds: ['click'] },
      ],
    },
  ],
}
// #far sits ~3000px down — below any default viewport, so it starts offscreen.
const HTML = `<!doctype html><title>SC</title>
<button id="top">Top</button>
<div style="height:3000px"></div>
<button id="far">Far</button>
<script>window.__agrune_manifest__=${JSON.stringify(MANIFEST)}</script>`

let server: http.Server
let baseUrl = ''
let handle: DaemonHandle | null = null
let endpoint = ''
let dir = ''
let ok = true

const post = (p: string, b: Record<string, unknown>) => requestJson(endpoint, 'POST', p, b)
const get = (p: string) => requestJson(endpoint, 'GET', p)
const farInViewport = async (): Promise<boolean> => {
  const r = (await get('/targets')) as any
  return r.snapshot.targets.find((t: any) => t.targetId === 'far').inViewport
}

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html' })
    res.end(HTML)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const addr = server.address()
  baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}/` : ''

  dir = mkdtempSync(join(tmpdir(), 'agrune-scroll-'))
  endpoint = `unix:${join(dir, 'd.sock')}`
  try {
    handle = await startDaemon({ endpoint, headless: true })
    await post('/open', { url: baseUrl })
  } catch {
    ok = false
  }
}, 60_000)

afterAll(async () => {
  await handle?.close()
  await new Promise<void>((resolve) => server.close(() => resolve()))
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('scroll verb (§6.5, real chromium)', () => {
  it('a far target starts offscreen, then scroll brings it into view', async () => {
    if (!ok) return
    expect(await farInViewport()).toBe(false)
    const r = (await post('/scroll', { target: 'far' })) as any
    expect(r.action).toBe('scroll')
    expect(r.target).toBe('far')
    expect(await farInViewport()).toBe(true)
  })

  it('--to center is echoed back and also lands the target in view', async () => {
    if (!ok) return
    // Reset to the top first so the assertion is meaningful.
    await post('/scroll', { target: 'top' })
    expect(await farInViewport()).toBe(false)
    const r = (await post('/scroll', { target: 'far', to: 'center' })) as any
    expect(r.action).toBe('scroll')
    expect(r.to).toBe('center')
    expect(await farInViewport()).toBe(true)
  })

  it('rejects an invalid --to value', async () => {
    if (!ok) return
    await expect(post('/scroll', { target: 'far', to: 'middle' })).rejects.toMatchObject({
      code: 'INVALID_COMMAND',
    })
  })
})

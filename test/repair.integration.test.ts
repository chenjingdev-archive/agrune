// Autonomous repair gate (§12.4, B3a) — live verification + the full §12 round-trip. On a page
// whose DOM has moved on, only a CORRECT patch that resolves passes the gate; wrong / invalid /
// invented patches are dropped. The eligible merge is then signed, published to a dir store, served,
// and re-fetched through the SAME runtime trust gate (B1b) — proving propose → verify → publish closes.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { chromium, type Browser, type Page } from 'playwright'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { verifyRepair, runRepair, type TargetPatch } from '../src/repair.js'
import { signManifest, publishToDir, fetchLatestManifest } from '../src/manifest-store.js'
import type { AgruneManifest, ManifestTarget } from '../src/manifest.js'

// Base manifest points at the OLD DOM ids; the live page has moved to #a2 / #c2.
const BASE: AgruneManifest = {
  version: 3,
  groups: [
    {
      groupId: 'board',
      name: 'Board',
      targets: [
        { targetId: 'a', name: 'A', selector: { css: '#a' }, actionKinds: ['click'] },
        { targetId: 'b', name: 'B', selector: { css: '#b' }, actionKinds: ['click'] },
        { targetId: 'c', name: 'C', selector: { css: '#c' }, actionKinds: ['click'] },
      ],
    },
  ],
}
const HTML = `<!doctype html><title>RP</title>
<button id="a2">A</button><button id="c2">C</button>`

let browser: Browser | null = null
let page: Page | null = null
let available = true

beforeAll(async () => {
  try {
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage()
    await page.setContent(HTML)
  } catch {
    available = false
  }
}, 60_000)

afterAll(async () => {
  await browser?.close()
})

describe('B3a — verifyRepair gate (real chromium)', () => {
  it('admits only the patch that resolves on the live page; drops wrong / invalid / invented', async () => {
    if (!available || !page) return
    const patches: TargetPatch[] = [
      { groupId: 'board', targetId: 'a', selector: { css: '#a2' } }, // correct → resolves
      { groupId: 'board', targetId: 'b', selector: { css: '#nope' } }, // wrong → no resolve
      { groupId: 'board', targetId: 'c', selector: { css: '.list:nth-child(2)' } }, // forbidden → invalid
      { groupId: 'board', targetId: 'ghost', selector: { css: '#x' } }, // invented → unmatched
    ]
    const result = await verifyRepair(page, BASE, patches)

    expect(result.eligible).toEqual([{ groupId: 'board', targetId: 'a', selector: { css: '#a2' } }])

    const byId = Object.fromEntries(result.verdicts.map((v) => [v.targetId, v]))
    expect(byId.a!.eligible).toBe(true)
    expect(byId.b!.resolves).toBe(false)
    expect(byId.b!.eligible).toBe(false)
    expect(byId.c!.validates).toBe(false) // forbidden :nth-child caught by validateManifest
    expect(byId.ghost!.matched).toBe(false)

    // The merged result carries the fix for `a` and FREEZES the others (still old selectors).
    const board = result.merged.groups[0]!
    expect(board.targets.find((t) => t.targetId === 'a')!.selector).toEqual({ css: '#a2' })
    expect(board.targets.find((t) => t.targetId === 'b')!.selector).toEqual({ css: '#b' })
  })

  it('the verified merge round-trips: sign → publish to a dir store → fetch → re-verify', async () => {
    if (!available || !page) return
    const { publicKey, privateKey } = generateKeyPairSync('ed25519')
    const { merged } = await verifyRepair(page, BASE, [
      { groupId: 'board', targetId: 'a', selector: { css: '#a2' } },
    ])

    const root = mkdtempSync(join(tmpdir(), 'agrune-store-dir-'))
    // A static server over the publish dir IS the store (URL layout mirrors storePathFor).
    const server = http.createServer((req, res) => {
      try {
        // The URL path segments are encodeURIComponent'd (same as storePathFor's dir names), so map
        // req.url to disk verbatim — decoding would split the encoded origin across directories.
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(readFileSync(join(root, req.url ?? ''), 'utf8'))
      } catch {
        res.writeHead(404).end('not found')
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const port = (server.address() as { port: number }).port

    try {
      const addr = { origin: 'https://app.test', schemaVersion: 3 }
      const env = signManifest(merged, { author: 'agent', origin: addr.origin }, privateKey)
      publishToDir(root, addr, env)

      const fetched = await fetchLatestManifest({
        storeBase: `http://127.0.0.1:${port}`,
        pinnedKey: publicKey,
        addr,
      })
      expect(fetched.ok).toBe(true)
      if (!fetched.ok) return
      // The runtime's trust gate accepts the harness output, and it carries the verified fix.
      expect(fetched.value.manifest.groups[0]!.targets.find((t) => t.targetId === 'a')!.selector).toEqual({ css: '#a2' })
      expect(fetched.value.provenance.author).toBe('agent')
    } finally {
      await new Promise<void>((r) => server.close(() => r()))
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('B3b — runRepair loop (propose → verify → publish gate)', () => {
  const drifted = (id: string): { groupId: string; target: ManifestTarget } => ({
    groupId: 'board',
    target: BASE.groups[0]!.targets.find((t) => t.targetId === id)!,
  })

  it('publishes only when a proposal passes the gate', async () => {
    if (!available || !page) return
    let published: AgruneManifest | null = null
    // A "good enough" agent: proposes the correct new id for `a`, a dud for `b`.
    const propose = async (target: ManifestTarget) =>
      target.targetId === 'a' ? { css: '#a2' } : { css: '#still-wrong' }
    const outcome = await runRepair({
      page,
      base: BASE,
      ariaFallback: '- button "A"\n- button "C"',
      drifted: [drifted('a'), drifted('b')],
      propose,
      publish: async (merged) => void (published = merged),
    })
    expect(outcome.publishable).toBe(true)
    expect(outcome.result.eligible.map((p) => p.targetId)).toEqual(['a'])
    expect(published).not.toBeNull()
    expect(published!.groups[0]!.targets.find((t) => t.targetId === 'a')!.selector).toEqual({ css: '#a2' })
  })

  it('does NOT publish when every proposal fails the gate (guess → publish is impossible)', async () => {
    if (!available || !page) return
    let publishCalled = false
    const outcome = await runRepair({
      page,
      base: BASE,
      ariaFallback: '- button "A"',
      drifted: [drifted('a'), drifted('b')],
      propose: async () => ({ css: '#does-not-exist' }),
      publish: async () => void (publishCalled = true),
    })
    expect(outcome.publishable).toBe(false)
    expect(publishCalled).toBe(false)
  })
})

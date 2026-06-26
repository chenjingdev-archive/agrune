// §8.8 manifest-only — the raw-selector escape is closed on a LIVE page. The whole-page route gate
// is unit-tested separately; this proves the second half: snapshot/screenshot/evaluate --target may
// reach a DECLARED ref but NOT an arbitrary CSS selector, even though the element plainly exists.
// Without this, an agent could read/screenshot any DOM node by selector and route around the manifest.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { chromium, type Browser, type Page } from 'playwright'
import { resolveTargetOrSelectorLocator } from '../src/resolver.js'
import type { AgruneManifest } from '../src/manifest.js'

const MANIFEST: AgruneManifest = {
  version: 3,
  groups: [
    {
      groupId: 'g',
      name: 'G',
      targets: [{ targetId: 'save', name: 'Save', selector: { css: '#declared-btn' }, actionKinds: ['click'] }],
    },
  ],
}
const HTML = `<!doctype html><title>MO</title>
<button id="declared-btn">Save</button>
<div id="raw-only">secret-not-in-manifest</div>`

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

describe('§8.8 manifest-only — raw-selector escape closed (real chromium)', () => {
  it('resolves a DECLARED ref under manifestOnly', async () => {
    if (!available || !page) return
    const loc = await resolveTargetOrSelectorLocator(page, 'save', { manifestOverride: MANIFEST, manifestOnly: true })
    expect(await loc.count()).toBe(1)
  })

  it('REFUSES a raw CSS selector under manifestOnly — even though the element exists', async () => {
    if (!available || !page) return
    // #raw-only is plainly present, but it is not a declared ref → no raw fallback under strict.
    await expect(
      resolveTargetOrSelectorLocator(page, '#raw-only', { manifestOverride: MANIFEST, manifestOnly: true }),
    ).rejects.toThrow()
  })

  it('the SAME raw selector resolves when manifestOnly is OFF (proves the gate, not a typo)', async () => {
    if (!available || !page) return
    const loc = await resolveTargetOrSelectorLocator(page, '#raw-only', { manifestOverride: MANIFEST })
    expect(await loc.count()).toBe(1)
  })
})

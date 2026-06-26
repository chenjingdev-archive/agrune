// §8.8 manifest-only route gate — the deterministic classifier. Proves the strict boundary refuses
// every escape-hatch verb (arbitrary code + whole-surface perception) while leaving the declared
// action surface untouched. This is the security-load-bearing unit: a gap here = a boundary bypass.

import { describe, it, expect } from 'vitest'
import { enforceManifestOnly } from '../src/manifest-only.js'
import { CliError } from '../src/errors.js'

const q = (params: Record<string, string> = {}): URLSearchParams => new URLSearchParams(params)

/** Run the gate; return the thrown CliError, or null if it allowed the route. */
function gate(route: string, body: Record<string, unknown> = {}, query = q()): CliError | null {
  try {
    enforceManifestOnly(route, body, query)
    return null
  } catch (e) {
    if (e instanceof CliError) return e
    throw e
  }
}

describe('§8.8 manifest-only gate — DENY (code-exec / raw input / credential exfil / full export)', () => {
  const denied = [
    // arbitrary code / out-of-band control
    ['POST /evaluate', 'arbitrary page JS'],
    ['POST /run-code', 'arbitrary code'],
    ['POST /run-code-unsafe', 'arbitrary code (unsafe)'],
    ['GET /generate-locator', 'raw-selector minting'],
    ['POST /pause', 'debugger pause'],
    // whole-surface perception / export
    ['GET /read', 'full-page innerText dump'],
    ['POST /pdf', 'full-surface PDF export'],
    // raw input family — no manifest ref, actuates by coordinate / focus (audit-confirmed bypass)
    ['POST /mousemove', 'raw cursor positioning'],
    ['POST /mousedown', 'raw-coordinate press'],
    ['POST /mouseup', 'raw-coordinate release'],
    ['POST /mousewheel', 'raw scroll'],
    ['POST /keydown', 'raw keystroke to focus'],
    ['POST /keyup', 'raw keystroke to focus'],
    // credential / sensitive-data exfiltration (audit-confirmed bypass)
    ['GET /cookies', 'all cookies incl. HttpOnly'],
    ['GET /cookies/get', 'single-cookie credential read'],
    ['POST /state-save', 'full auth-state dump to file'],
    ['POST /storage', 'localStorage/sessionStorage dump'],
    ['GET /network', 'request URLs (query-string tokens)'],
    ['GET /network/request', 'request/response headers+bodies'],
  ] as const

  for (const [route, why] of denied) {
    it(`refuses ${route} (${why})`, () => {
      const err = gate(route)
      expect(err).toBeInstanceOf(CliError)
      expect(err!.code).toBe('MANIFEST_ONLY')
      // the refusal names the verb so the agent learns what to avoid
      expect(err!.details?.route).toBe(route)
    })
  }
})

describe('§8.8 manifest-only gate — SCOPE (whole-surface variant denied, target-scoped allowed)', () => {
  it('refuses a whole-page a11y snapshot (no target)', () => {
    expect(gate('GET /snapshot')?.code).toBe('MANIFEST_ONLY')
  })
  it('refuses snapshot with a blank/whitespace target', () => {
    expect(gate('GET /snapshot', {}, q({ target: '  ' }))?.code).toBe('MANIFEST_ONLY')
  })
  it('ALLOWS a target-scoped snapshot of a declared ref', () => {
    expect(gate('GET /snapshot', {}, q({ target: 'wizard_title_input' }))).toBeNull()
  })

  it('refuses a full-page screenshot', () => {
    expect(gate('POST /screenshot', { path: 'x.png', fullPage: true })?.code).toBe('MANIFEST_ONLY')
  })
  it('ALLOWS a viewport screenshot (fullPage falsy)', () => {
    expect(gate('POST /screenshot', { path: 'x.png' })).toBeNull()
    expect(gate('POST /screenshot', { path: 'x.png', fullPage: false })).toBeNull()
  })
  it('ALLOWS a target-scoped screenshot', () => {
    expect(gate('POST /screenshot', { path: 'x.png', target: 'board_card' })).toBeNull()
  })

  it('refuses a target-less (page-global) press', () => {
    expect(gate('POST /press', { key: 'Enter' })?.code).toBe('MANIFEST_ONLY')
  })
  it('ALLOWS press on a declared target (resolves a ref)', () => {
    expect(gate('POST /press', { key: 'Enter', target: 'wizard_next_button' })).toBeNull()
  })
})

describe('§8.8 manifest-only gate — ALLOW (the declared action surface is untouched)', () => {
  const allowed = [
    ['POST /click', { target: 'save_button' }],
    ['POST /fill', { target: 'wizard_title_input', value: 'x' }],
    ['POST /select', { target: 'assignee', values: ['bob'] }],
    ['POST /check', { target: 'agree' }],
    ['POST /type', { target: 'search', text: 'hi' }],
    ['POST /wait', { text: 'Done' }],
    ['POST /scroll', { target: 'footer_link' }],
    ['POST /navigate', { url: 'https://app.test' }],
    ['GET /targets', {}],
    ['GET /tabs', {}],
    ['POST /back', {}],
  ] as const

  for (const [route, body] of allowed) {
    it(`allows ${route}`, () => {
      expect(gate(route, body as Record<string, unknown>)).toBeNull()
    })
  }
})

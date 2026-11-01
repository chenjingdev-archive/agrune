// §8.8 manifest-only (strict capability) mode — the daemon-route gate.
//
// In manifest-only mode the manifest is a HARD capability boundary, not just a narrowed view. An
// agent (or a prompt-injected page steering one) must not be able to reach OUTSIDE what the app
// declared. The single choke point is daemon.ts's `routeRequest`, where every command has already
// been reduced to a `"METHOD /path"` string — so one gate here covers the whole command surface.
//
// Two escape classes are closed:
//   - ARBITRARY CODE / FULL PERCEPTION (DENY): evaluate / run-code / raw a11y snapshot / full-page
//     read / generate-locator / debugger pause. These hand the agent capabilities the manifest
//     never granted (run any JS, dump the whole page, mint raw selectors), so they are refused
//     outright. Target-scoped variants survive via the SCOPE rules below.
//   - RAW-SELECTOR REUSE (SCOPE): snapshot/screenshot may still inspect a SINGLE element, but only
//     a declared manifest ref — never a raw CSS selector (that bypass is closed in the resolver via
//     ResolveOptions.manifestOnly; here we only forbid the whole-surface variants).
//
// Everything else — click/fill/select/check/type/press/wait/scroll/targets/navigation — is allowed
// unchanged, because the action resolver (resolveTargetLocator) already accepts declared refs only.
//
// The verdict carries a human reason so the agent learns WHY and routes back through the declared
// surface instead of blindly retrying the dead verb.

import { CliError } from './errors.js'

// The denied set was hardened by an adversarial audit (4 threat lenses × refute-verify): the first
// draft only closed code-exec + whole-page perception and MISSED two whole families that defeat the
// boundary just as hard —
//   - RAW INPUT (mouse/key) carries NO manifest ref: it actuates by coordinate / current focus, so
//     `mousemove{x,y}`+`mousedown`+`mouseup` synthesizes a click on ANY pixel (e.g. an undeclared
//     "Delete account" button), and `keydown`/`keyup` fire keystrokes at whatever has focus. Unlike
//     click/fill these never call resolveTargetLocator, so they cannot be ref-scoped — deny outright.
//   - CREDENTIAL / NETWORK / FULL-EXPORT channels read the whole context, not a declared target:
//     cookies (incl. HttpOnly), storage state, localStorage/sessionStorage, captured request/response
//     headers+bodies (Authorization/Cookie), and page.pdf() (renders the entire surface to a file).
/** Routes refused unconditionally in manifest-only mode. */
const DENIED_ROUTES = new Set<string>([
  // arbitrary code / out-of-band control
  'POST /evaluate', // arbitrary JS in the page (page-level; the target-scoped form is also code exec)
  'POST /run-code',
  'POST /run-code-unsafe',
  'POST /pause', // debugger pause → arbitrary out-of-band interaction
  'GET /generate-locator', // mints raw Playwright selectors → a manifest-bypass primitive
  // whole-surface perception / export
  'GET /read', // full-page innerText dump
  'POST /pdf', // page.pdf() renders the ENTIRE surface (declared-hidden + undeclared) to a file
  // raw input — no manifest ref; actuates by coordinate / focus, so it escapes the boundary entirely
  'POST /mousemove',
  'POST /mousedown',
  'POST /mouseup',
  'POST /mousewheel',
  'POST /keydown',
  'POST /keyup',
  // credential / sensitive-data exfiltration — reads the whole context, not a declared target
  'GET /cookies', // all cookies for all origins, incl. HttpOnly session cookies
  'GET /cookies/get', // single-cookie read is the same credential surface
  'POST /state-save', // context.storageState() = full auth dump to an attacker-named path
  'POST /storage', // dumps localStorage/sessionStorage (JWTs, tokens)
  'GET /network', // request URLs across navigations — query-string tokens/session ids
  'GET /network/request', // full request/response headers+bodies (Authorization/Cookie/Set-Cookie)
])

/** True iff the route is allowed to PROCEED in manifest-only mode. Throws CliError otherwise. */
export function enforceManifestOnly(
  route: string,
  body: Record<string, unknown>,
  query: URLSearchParams,
): void {
  if (DENIED_ROUTES.has(route)) {
    throw refusal(route, verbOf(route))
  }

  // SCOPE: raw a11y snapshot of the WHOLE page is full perception; a target-scoped snapshot of a
  // declared ref is fine (the resolver rejects raw selectors under manifestOnly).
  if (route === 'GET /snapshot' && !hasText(query.get('target'))) {
    throw refusal(route, 'snapshot', 'a whole-page a11y snapshot')
  }

  // SCOPE: a full-page screenshot captures the entire surface; a target-scoped or viewport shot is
  // fine. (A viewport shot shows only what is already on screen, not the declared-but-hidden parts.)
  if (route === 'POST /screenshot' && body.fullPage === true) {
    throw refusal(route, 'screenshot', 'a full-page screenshot')
  }

  // SCOPE: `press` with a declared target resolves a ref (safe); WITHOUT a target it routes to a
  // page-global key chord (Enter/Tab/shortcuts) at whatever has focus — off-manifest actuation. So
  // require a target, mirroring the raw-key family being denied outright.
  if (route === 'POST /press' && !hasText(typeof body.target === 'string' ? body.target : undefined)) {
    throw refusal(route, 'press', 'a target-less (page-global) key press')
  }
}

function verbOf(route: string): string {
  return route.split(' ')[1]?.replace(/^\//, '') ?? route
}

function hasText(v: string | null | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

function refusal(route: string, verb: string, what = `'${verb}'`): CliError {
  return new CliError(
    'MANIFEST_ONLY',
    `manifest-only mode: ${what} is disabled — operate via declared manifest targets, or ask the operator to relax AGRUNE_MANIFEST_ONLY`,
    { code: 'MANIFEST_ONLY', route, verb },
  )
}

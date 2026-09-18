// Shared manifest conformance vector (PLAN Phase 0 "Done").
//
// Framework-agnostic: a list of input manifests + their expected verdicts, plus a runner that takes
// a `validate` function and reports pass/fail. The core runs it (vitest) with the core's
// validateManifest; Studio runs it (node:test) with Studio's re-exported validateManifest. Because
// both validateManifest values resolve to THIS package's single source, identical verdicts here are
// the proof that a manifest valid in Studio is byte-identically accepted by the runtime.

import type { ValidateResult } from './index.js'

export interface ConformanceCase {
  /** Stable identifier for the case. */
  readonly name: string
  /** The raw manifest input fed to validateManifest. */
  readonly input: unknown
  /** Expected verdict. */
  readonly expect: 'ok' | 'fail'
  /** When expect==='fail', at least one error message must match this RegExp source string. */
  readonly errorMatch?: string
}

// The A.7.1 golden manifest, reproduced verbatim (4 groups; one sensitive target; one repeat with
// two row templates). Kept in sync with the core's test/fixtures/golden-manifest.ts.
const goldenManifest = {
  groups: [
    {
      groupId: 'login',
      name: 'Login Form',
      desc: 'Authenticate to the app',
      targets: [
        {
          targetId: 'username_input',
          name: 'Username',
          desc: 'Your account name',
          selector: { css: '#user' },
          actionKinds: ['fill'],
        },
        {
          targetId: 'password_input',
          name: 'Password',
          selector: { css: '#pass' },
          actionKinds: ['fill'],
          sensitive: true,
        },
      ],
    },
    {
      groupId: 'todos',
      targets: [
        {
          targetId: 'new_todo_input',
          name: 'New todo',
          selector: { css: '#new-todo' },
          actionKinds: ['fill'],
        },
      ],
      repeats: [
        {
          repeatId: 'todo_items',
          keyFrom: 'el.dataset.id ?? ""',
          nameFrom: 'el.querySelector("label")?.textContent?.trim() ?? ""',
          strategy: 'dom',
          containerSelector: { css: '.todo-list' },
          targets: [
            { targetId: 'todo_item_toggle', name: 'Toggle', selector: { css: '.toggle' }, actionKinds: ['click'] },
            { targetId: 'todo_item_destroy', name: 'Destroy', selector: { css: '.destroy' }, actionKinds: ['click'] },
          ],
        },
      ],
    },
    {
      groupId: 'filters',
      name: 'Filters',
      desc: 'Route buttons',
      targets: [
        { targetId: 'filter_all', name: 'All', selector: { css: 'a[href="#/all"]' }, actionKinds: ['click'] },
      ],
    },
    { groupId: 'empty_group', name: 'Empty', targets: [] },
  ],
}

export const CONFORMANCE_CASES: readonly ConformanceCase[] = [
  {
    name: 'minimal-valid',
    expect: 'ok',
    input: {
      version: 3,
      groups: [
        {
          groupId: 'page',
          targets: [
            { targetId: 'signin', actionKinds: ['click'], selector: { role: { name: 'button' }, text: 'Sign in' } },
          ],
        },
      ],
    },
  },
  {
    name: 'golden-A.7-version-defaulted-template-omitted',
    expect: 'ok',
    input: goldenManifest,
  },
  {
    name: 'tailwind-utilities-not-flagged',
    expect: 'ok',
    input: {
      version: 3,
      groups: [
        {
          groupId: 'g',
          targets: [{ targetId: 't', selector: { css: '.bg-blue-500.items-center' }, actionKinds: ['click'] }],
        },
      ],
    },
  },
  {
    name: 'empty-selector-ladder-rejected',
    expect: 'fail',
    errorMatch: 'at least one',
    input: {
      version: 3,
      groups: [{ groupId: 'page', targets: [{ targetId: 'empty', actionKinds: ['click'], selector: {} }] }],
    },
  },
  {
    name: 'sensitive-false-rejected-OR-only',
    expect: 'fail',
    errorMatch: 'OR-only',
    input: {
      version: 3,
      groups: [
        {
          groupId: 'login',
          targets: [
            { targetId: 'password', actionKinds: ['fill'], selector: { css: 'input[type="password"]' }, sensitive: false },
          ],
        },
      ],
    },
  },
  {
    name: 'hash-class-rejected',
    expect: 'fail',
    errorMatch: 'hash class forbidden',
    input: {
      version: 3,
      groups: [{ groupId: 'g', targets: [{ targetId: 'hashy', actionKinds: ['click'], selector: { css: '.aB3xK9p2' } }] }],
    },
  },
  {
    name: 'nth-child-rejected',
    expect: 'fail',
    errorMatch: ':nth-child forbidden',
    input: {
      version: 3,
      groups: [
        { groupId: 'g', targets: [{ targetId: 'pos', actionKinds: ['click'], selector: { attr: 'ul > li:nth-child(2)' } }] },
      ],
    },
  },
  {
    name: 'version-2-rejected',
    expect: 'fail',
    input: { version: 2, groups: [] },
  },
  {
    name: 'empty-keyFrom-rejected',
    expect: 'fail',
    errorMatch: 'keyFrom is required',
    input: {
      version: 3,
      groups: [
        {
          groupId: 'g',
          targets: [],
          repeats: [
            {
              repeatId: 'r',
              keyFrom: '   ',
              strategy: 'dom',
              targets: [{ targetId: 't', selector: { css: '.row' }, actionKinds: ['click'] }],
            },
          ],
        },
      ],
    },
  },
]

export interface ConformanceResult {
  readonly case: ConformanceCase
  readonly pass: boolean
  readonly detail?: string
}

/** Run every conformance case against `validate`; returns one result per case. */
export function runConformance(validate: (input: unknown) => ValidateResult): ConformanceResult[] {
  return CONFORMANCE_CASES.map((c) => {
    const result = validate(c.input)
    if (c.expect === 'ok') {
      if (result.ok) return { case: c, pass: true }
      return {
        case: c,
        pass: false,
        detail: `expected ok, got errors: ${result.errors.map((e) => e.message).join(' | ')}`,
      }
    }
    // expect fail
    if (result.ok) return { case: c, pass: false, detail: 'expected fail, but validated ok' }
    if (c.errorMatch === undefined) return { case: c, pass: true }
    const re = new RegExp(c.errorMatch)
    const matched = result.errors.some((e) => re.test(e.message))
    return matched
      ? { case: c, pass: true }
      : {
          case: c,
          pass: false,
          detail: `no error matched /${c.errorMatch}/; got: ${result.errors.map((e) => e.message).join(' | ')}`,
        }
  })
}

/** Throw if any conformance case fails. The single assertion both packages call from their tests. */
export function assertConformance(validate: (input: unknown) => ValidateResult): void {
  const failures = runConformance(validate).filter((r) => !r.pass)
  if (failures.length > 0) {
    throw new Error(
      `Manifest conformance failed (${failures.length}/${CONFORMANCE_CASES.length}):\n` +
        failures.map((f) => ` - ${f.case.name}: ${f.detail ?? 'unknown'}`).join('\n'),
    )
  }
}

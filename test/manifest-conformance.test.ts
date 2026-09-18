// Shared manifest conformance vector — run against the CORE validator (PLAN Phase 0 "Done").
//
// The SAME vector runs in Studio (src/conformance.test.ts). Both resolve validateManifest to the
// single @agrune/manifest source, so identical verdicts on both sides are the proof that a manifest
// valid in Studio is byte-identically accepted by the runtime.

import { describe, it, expect } from 'vitest'
import { validateManifest, CONFORMANCE_CASES, runConformance, assertConformance } from '../src/manifest.js'

describe('manifest conformance vector (core validator)', () => {
  it('the full vector passes', () => {
    expect(() => assertConformance(validateManifest)).not.toThrow()
  })

  const results = runConformance(validateManifest)
  for (const r of results) {
    it(`case: ${r.case.name}`, () => {
      expect(r.pass, r.detail).toBe(true)
    })
  }

  it('covers every case', () => {
    expect(results).toHaveLength(CONFORMANCE_CASES.length)
  })
})

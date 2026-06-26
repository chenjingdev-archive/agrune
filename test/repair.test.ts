// Autonomous repair gate (§12.4, B3a) — pure parts. The patch-merge FREEZES healthy targets, and
// the signer round-trips through the exact verify gate the runtime uses on fetch (so the harness can
// only publish artifacts the runtime would accept). Plus the dir-publish backend.

import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mergeManifestPatch, type TargetPatch } from '../src/repair.js'
import {
  signManifest,
  verifyEnvelope,
  parseSigningKey,
  publishToDir,
  storePathFor,
} from '../src/manifest-store.js'
import type { AgruneManifest } from '../src/manifest.js'

const BASE: AgruneManifest = {
  version: 3,
  groups: [
    {
      groupId: 'board',
      name: 'Board',
      targets: [
        { targetId: 'a', name: 'A', selector: { css: '#a' }, actionKinds: ['click'], onSuccess: 'opened' },
        { targetId: 'b', name: 'B', selector: { css: '#b' }, actionKinds: ['click'] },
      ],
    },
    {
      groupId: 'nav',
      targets: [{ targetId: 'home', name: 'Home', selector: { css: '#home' }, actionKinds: ['click'] }],
    },
  ],
}

describe('B3a — mergeManifestPatch freezes healthy targets', () => {
  it('replaces ONLY the named selector; everything else stays byte-identical', () => {
    const patches: TargetPatch[] = [{ groupId: 'board', targetId: 'a', selector: { css: '#a2' } }]
    const merged = mergeManifestPatch(BASE, patches)

    // Patched target: new selector, all other fields preserved.
    const a = merged.groups[0]!.targets[0]!
    expect(a.selector).toEqual({ css: '#a2' })
    expect(a.onSuccess).toBe('opened')
    expect(a.name).toBe('A')

    // Sibling target in the same group: frozen (same reference → byte-identical).
    expect(merged.groups[0]!.targets[1]).toBe(BASE.groups[0]!.targets[1])
    // Untouched group: frozen (same reference).
    expect(merged.groups[1]).toBe(BASE.groups[1])
    // The base is not mutated.
    expect(BASE.groups[0]!.targets[0]!.selector).toEqual({ css: '#a' })
  })

  it('empty patches return the base unchanged', () => {
    expect(mergeManifestPatch(BASE, [])).toBe(BASE)
  })

  it('a patch for an untouched group leaves other groups frozen', () => {
    const merged = mergeManifestPatch(BASE, [{ groupId: 'nav', targetId: 'home', selector: { css: '#home2' } }])
    expect(merged.groups[0]).toBe(BASE.groups[0])
    expect(merged.groups[1]!.targets[0]!.selector).toEqual({ css: '#home2' })
  })
})

describe('B3a — signManifest round-trips through the verify gate', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')

  it('verifyEnvelope(signManifest(m)) === m, with provenance carried under the signature', () => {
    const env = signManifest(BASE, { author: 'agent', origin: 'https://app.test' }, privateKey, 'k1')
    const r = verifyEnvelope(env, publicKey)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.manifest).toEqual(BASE)
    expect(r.value.provenance).toEqual({ author: 'agent', origin: 'https://app.test' })
    expect(r.value.keyId).toBe('k1')
  })

  it('a signature from a different key fails the gate (publish path cannot bypass verify)', () => {
    const other = generateKeyPairSync('ed25519')
    const env = signManifest(BASE, undefined, other.privateKey)
    const r = verifyEnvelope(env, publicKey)
    expect(r.ok).toBe(false)
  })

  it('parseSigningKey: private ed25519 PEM ok; public PEM / RSA → null', () => {
    const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(parseSigningKey(privPem)).not.toBeNull()
    const pubPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(parseSigningKey(pubPem)).toBeNull()
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    expect(parseSigningKey(rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())).toBeNull()
  })
})

describe('B3a — publish to a dir store (the §12.2 fetch path served from disk)', () => {
  const { privateKey } = generateKeyPairSync('ed25519')

  it('storePathFor mirrors manifestUrl; publishToDir writes the envelope', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agrune-pub-'))
    try {
      const addr = { origin: 'https://app.test', schemaVersion: 3 }
      const expectedPath = join(dir, encodeURIComponent('https://app.test'), '3', 'manifest.json')
      expect(storePathFor(dir, addr)).toBe(expectedPath)

      const env = signManifest(BASE, { author: 'agent' }, privateKey)
      const written = publishToDir(dir, addr, env)
      expect(written).toBe(expectedPath)
      const onDisk = JSON.parse(readFileSync(written, 'utf8'))
      expect(onDisk.payloadJson).toBe(env.payloadJson)
      expect(onDisk.alg).toBe('ed25519')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

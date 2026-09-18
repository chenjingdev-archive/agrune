// C4 + C5 (Phase 6) — the generic signed envelope (scenarios/packs) and the store index.

import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  signPayload,
  verifyPayloadEnvelope,
  publishPackToDir,
  scanStore,
  writeStoreIndex,
  readStoreIndex,
} from '../src/pack-store.js'
import {
  generateKeyPair,
  emptyKeyset,
  grantAdmin,
  revokeAdmin,
  signKeyset,
  verifyPayloadWithKeyset,
} from '../src/keyset.js'
import { parsePinnedKey, parseSigningKey } from '../src/manifest-store.js'

function actor() {
  const kp = generateKeyPair()
  return { kp, priv: parseSigningKey(kp.privateKeyPem)!, pub: parsePinnedKey(kp.publicKeyBase64)! }
}

describe('C4 — generic signed payload envelope', () => {
  it('round-trips arbitrary data under the signature', () => {
    const a = actor()
    const env = signPayload({ hello: 'world', n: [1, 2, 3] }, { author: 'human' }, a.priv, a.kp.keyId)
    const r = verifyPayloadEnvelope<{ hello: string; n: number[] }>(env, a.pub)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.value.data.hello).toBe('world')
      expect(r.value.keyId).toBe(a.kp.keyId)
      expect(r.value.provenance.author).toBe('human')
    }
  })

  it('rejects a wrong key and a tampered payload', () => {
    const a = actor()
    const b = actor()
    const env = signPayload({ x: 1 }, undefined, a.priv)
    expect(verifyPayloadEnvelope(env, b.pub).ok).toBe(false)
    const tampered = { ...env, payloadJson: env.payloadJson.replace('1', '2') }
    expect(verifyPayloadEnvelope(tampered, a.pub).ok).toBe(false)
  })

  it('keyset-aware verify accepts an admin, rejects after revoke + forged keyset', () => {
    const root = actor()
    const admin = actor()
    const env = signPayload({ pack: true }, undefined, admin.priv, admin.kp.keyId)
    let ks = grantAdmin(emptyKeyset(root.pub), { keyId: admin.kp.keyId, publicKey: admin.kp.publicKeyBase64 })
    expect(verifyPayloadWithKeyset(env, root.pub, signKeyset(ks, root.priv)).ok).toBe(true)
    ks = revokeAdmin(ks, admin.kp.keyId)
    const revoked = verifyPayloadWithKeyset(env, root.pub, signKeyset(ks, root.priv))
    expect(revoked.ok).toBe(false)
    if (!revoked.ok) expect(revoked.reason).toBe('untrusted-signer')
    // keyset signed by a non-root key is rejected
    const forged = verifyPayloadWithKeyset(env, root.pub, signKeyset(ks, admin.priv))
    expect(forged.ok).toBe(false)
    if (!forged.ok) expect(forged.reason).toBe('untrusted-keyset')
  })
})

describe('C5 — store index', () => {
  it('enumerates published packs and round-trips the index', () => {
    const root = mkdtempSync(join(tmpdir(), 'agrune-core-store-'))
    const a = actor()
    for (const [origin, version] of [
      ['app.one', '1.0.0'],
      ['app.one', '1.1.0'],
      ['app.two', '2.0.0'],
    ] as const) {
      publishPackToDir(root, { origin, version }, signPayload({ origin, version }, undefined, a.priv))
    }
    const scanned = scanStore(root)
    expect(scanned).toHaveLength(3)
    expect(scanned.map((e) => `${e.origin}@${e.version}`)).toEqual(['app.one@1.0.0', 'app.one@1.1.0', 'app.two@2.0.0'])

    writeStoreIndex(root, '2026-06-27T00:00:00.000Z')
    const index = readStoreIndex(root)
    expect(index?.packs).toHaveLength(3)
    expect(index?.generatedAt).toBe('2026-06-27T00:00:00.000Z')
  })
})

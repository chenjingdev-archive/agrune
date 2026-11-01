// Manifest store client (§12.2, B1a) — the trust gate. These tests are adversarial: a manifest is
// swapped in ONLY when its ed25519 signature verifies against the pinned key. Everything trusted
// (manifest + provenance + keyId) lives UNDER the signature; the only outer fields are alg +
// signature. Unsigned, wrong key, tampered, unpinned, malformed, schema-invalid, oversize, and
// forged-outer-field envelopes must all be rejected or stripped.

import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  verifyEnvelope,
  parsePinnedKey,
  manifestUrl,
  fetchLatestManifest,
  loadManifestStoreConfig,
  ManifestCache,
  type ManifestEnvelope,
  type SignedPayload,
  type Transport,
} from '../src/manifest-store.js'

const GOOD_MANIFEST = {
  version: 3,
  groups: [
    {
      groupId: 'g',
      targets: [{ targetId: 't', name: 'T', selector: { css: '#t' }, actionKinds: ['click'] }],
    },
  ],
}

// A manifest that PARSES but fails the validation gates (forbidden :nth-child selector, §3.11).
const FORBIDDEN_MANIFEST = {
  version: 3,
  groups: [
    {
      groupId: 'g',
      targets: [
        { targetId: 't', name: 'T', selector: { css: '.list:nth-child(2)' }, actionKinds: ['click'] },
      ],
    },
  ],
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519')
const other = generateKeyPairSync('ed25519')

function signBytes(payloadJson: string, key: KeyObject): string {
  return cryptoSign(null, Buffer.from(payloadJson, 'utf8'), key).toString('base64')
}

/** Build a signed envelope from a SignedPayload; everything in `payload` is under the signature. */
function envelopeFor(payload: SignedPayload, key: KeyObject = privateKey): ManifestEnvelope {
  const payloadJson = JSON.stringify(payload)
  return { payloadJson, alg: 'ed25519', signature: signBytes(payloadJson, key) }
}

describe('B1a — verifyEnvelope trust gate (§12.2)', () => {
  it('accepts a correctly signed, valid manifest and returns signed provenance + contentHash', () => {
    const r = verifyEnvelope(envelopeFor({ manifest: GOOD_MANIFEST, meta: { author: 'human' } }), publicKey)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.manifest.groups[0]!.groupId).toBe('g')
    expect(r.value.provenance.author).toBe('human')
    expect(r.value.contentHash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('rejects when no key is pinned (refuse to trust anything)', () => {
    const r = verifyEnvelope(envelopeFor({ manifest: GOOD_MANIFEST }), null)
    expect(r).toEqual({ ok: false, reason: 'no-pinned-key' })
  })

  it('rejects an unsigned envelope', () => {
    const env = envelopeFor({ manifest: GOOD_MANIFEST })
    const r = verifyEnvelope({ payloadJson: env.payloadJson }, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unsigned')
  })

  it('rejects an unsupported algorithm', () => {
    const env = envelopeFor({ manifest: GOOD_MANIFEST })
    const r = verifyEnvelope({ ...env, alg: 'rsa' as never }, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('unsupported-alg')
  })

  it('rejects a manifest signed by a DIFFERENT (non-pinned) key', () => {
    const r = verifyEnvelope(envelopeFor({ manifest: GOOD_MANIFEST }, other.privateKey), publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad-signature')
  })

  it('rejects a tampered payload (signature over the ORIGINAL bytes no longer matches)', () => {
    const env = envelopeFor({ manifest: GOOD_MANIFEST })
    const tampered: ManifestEnvelope = {
      ...env,
      payloadJson: JSON.stringify({
        manifest: {
          version: 3,
          groups: [
            { groupId: 'evil', targets: [{ targetId: 'x', name: 'X', selector: { css: '#x' }, actionKinds: ['click'] }] },
          ],
        },
      }),
    }
    const r = verifyEnvelope(tampered, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad-signature')
  })

  it('rejects valid-signature-over-non-JSON as malformed', () => {
    const payloadJson = 'not json at all'
    const r = verifyEnvelope({ payloadJson, alg: 'ed25519', signature: signBytes(payloadJson, privateKey) }, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('malformed')
  })

  it('rejects a signed payload that is an array, not an object', () => {
    const payloadJson = JSON.stringify([{ manifest: GOOD_MANIFEST }])
    const r = verifyEnvelope({ payloadJson, alg: 'ed25519', signature: signBytes(payloadJson, privateKey) }, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('malformed')
  })

  it('rejects a signed-but-schema-invalid manifest (gates still run after the signature)', () => {
    const r = verifyEnvelope(envelopeFor({ manifest: FORBIDDEN_MANIFEST }), publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('invalid-manifest')
  })

  it('rejects an oversize payload before parsing (amplification guard)', () => {
    const payloadJson = '{"manifest":' + ' '.repeat(5 * 1024 * 1024) + '{}}'
    const r = verifyEnvelope({ payloadJson, alg: 'ed25519', signature: 'x' }, publicKey)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('too-large')
  })
})

describe('B1a — F1 fix: NOTHING trusted lives outside the signature', () => {
  it('ignores attacker-attached OUTER meta/keyId (they are not under the signature)', () => {
    const env = envelopeFor({ manifest: GOOD_MANIFEST }) // signed payload carries NO meta
    const forged = {
      ...env,
      // A MITM (or replay) attaches outer fields the signature never covered.
      meta: { origin: 'https://trusted-bank.example', author: 'human', schemaVersion: 'NOT_A_NUMBER' },
      keyId: { not: 'a string' },
    }
    const r = verifyEnvelope(forged, publicKey)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // Outer meta is ignored entirely → provenance comes only from inside the signature (empty here).
    expect(r.value.provenance).toEqual({})
    // Outer keyId object is ignored → no crash, no type confusion.
    expect(r.value.keyId).toBeUndefined()
  })

  it('takes provenance + keyId from INSIDE the signed payload only', () => {
    const r = verifyEnvelope(
      envelopeFor({ manifest: GOOD_MANIFEST, meta: { origin: 'https://app.test', author: 'agent', schemaVersion: 3 }, keyId: 'k1' }),
      publicKey,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.provenance).toEqual({ origin: 'https://app.test', author: 'agent', schemaVersion: 3 })
    expect(r.value.keyId).toBe('k1')
  })

  it('sanitizes type-confused signed provenance to declared types (no string-where-number, no array)', () => {
    const r = verifyEnvelope(
      envelopeFor({
        manifest: GOOD_MANIFEST,
        meta: { schemaVersion: '99' as never, author: 'nobody' as never, origin: 42 as never },
        keyId: 99 as never,
      }),
      publicKey,
    )
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // schemaVersion (string), author (not human|agent), origin (number) all dropped; keyId (number) dropped.
    expect(r.value.provenance).toEqual({})
    expect(r.value.keyId).toBeUndefined()
  })
})

describe('B1a — parsePinnedKey', () => {
  it('parses a PEM SPKI public key', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(parsePinnedKey(pem)).not.toBeNull()
  })

  it('parses a raw base64 32-byte ed25519 public key (compact form)', () => {
    const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('base64')
    const key = parsePinnedKey(raw)
    expect(key).not.toBeNull()
    const r = verifyEnvelope(envelopeFor({ manifest: GOOD_MANIFEST }), key)
    expect(r.ok).toBe(true)
  })

  it('rejects a non-ed25519 key (RSA) → null, so a misconfig fails closed', () => {
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const pem = rsa.publicKey.export({ type: 'spki', format: 'pem' }).toString()
    expect(parsePinnedKey(pem)).toBeNull()
  })

  it('returns null for empty / garbage / undefined', () => {
    expect(parsePinnedKey(undefined)).toBeNull()
    expect(parsePinnedKey('')).toBeNull()
    expect(parsePinnedKey('not-a-key')).toBeNull()
  })
})

describe('B1a — addressing + config', () => {
  it('manifestUrl builds <base>/<origin>/<schema>[/<appVersion>]/manifest.json', () => {
    expect(manifestUrl('https://store.test/', { origin: 'https://app.test', schemaVersion: 3 })).toBe(
      'https://store.test/https%3A%2F%2Fapp.test/3/manifest.json',
    )
    expect(
      manifestUrl('https://store.test', { origin: 'https://app.test', schemaVersion: 3, appVersion: 'v9' }),
    ).toBe('https://store.test/https%3A%2F%2Fapp.test/3/v9/manifest.json')
  })

  it('loadManifestStoreConfig: enabled only with a store base; key parsed from env', () => {
    const pem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const cfg = loadManifestStoreConfig({ AGRUNE_MANIFEST_STORE: 'https://store.test', AGRUNE_MANIFEST_STORE_KEY: pem } as NodeJS.ProcessEnv)
    expect(cfg.enabled).toBe(true)
    expect(cfg.storeBase).toBe('https://store.test')
    expect(cfg.pinnedKey).not.toBeNull()

    const off = loadManifestStoreConfig({} as NodeJS.ProcessEnv)
    expect(off.enabled).toBe(false)
    expect(off.pinnedKey).toBeNull()
  })
})

describe('B1a — fetchLatestManifest (stub transport)', () => {
  const addr = { origin: 'https://app.test', schemaVersion: 3 }

  it('200 + good signature → ok with etag', async () => {
    const transport: Transport = async () => ({
      status: 200,
      body: JSON.stringify(envelopeFor({ manifest: GOOD_MANIFEST })),
      headers: { etag: 'W/"abc"' },
    })
    const r = await fetchLatestManifest({ storeBase: 'https://store.test', pinnedKey: publicKey, addr, transport })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.etag).toBe('W/"abc"')
  })

  it('304 → not-modified (cache is current); sends If-None-Match', async () => {
    const transport: Transport = async (_url, headers) => {
      expect(headers['if-none-match']).toBe('W/"abc"')
      return { status: 304, body: '', headers: {} }
    }
    const r = await fetchLatestManifest({ storeBase: 'https://store.test', pinnedKey: publicKey, addr, knownEtag: 'W/"abc"', transport })
    expect(r).toEqual({ ok: false, reason: 'not-modified' })
  })

  it('404 → http error (no swap)', async () => {
    const transport: Transport = async () => ({ status: 404, body: 'nope', headers: {} })
    const r = await fetchLatestManifest({ storeBase: 'https://store.test', pinnedKey: publicKey, addr, transport })
    expect(r).toEqual({ ok: false, reason: 'http', status: 404 })
  })

  it('network throw → network error (no swap)', async () => {
    const transport: Transport = async () => {
      throw new Error('ECONNREFUSED')
    }
    const r = await fetchLatestManifest({ storeBase: 'https://store.test', pinnedKey: publicKey, addr, transport })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('network')
  })

  it('200 but signed by the wrong key → bad-signature surfaces through fetch (no swap)', async () => {
    const transport: Transport = async () => ({
      status: 200,
      body: JSON.stringify(envelopeFor({ manifest: GOOD_MANIFEST }, other.privateKey)),
      headers: {},
    })
    const r = await fetchLatestManifest({ storeBase: 'https://store.test', pinnedKey: publicKey, addr, transport })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('bad-signature')
  })
})

describe('B1a — ManifestCache round-trip', () => {
  it('put then get returns the same entry; missing key → null', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agrune-mcache-'))
    try {
      const cache = new ManifestCache(dir)
      const addr = { origin: 'https://app.test', schemaVersion: 3 }
      expect(cache.get(addr)).toBeNull()
      const entry = { etag: 'W/"abc"', contentHash: 'deadbeef', envelope: envelopeFor({ manifest: GOOD_MANIFEST }) }
      cache.put(addr, entry)
      const got = cache.get(addr)
      expect(got?.etag).toBe('W/"abc"')
      expect(got?.envelope.payloadJson).toBe(entry.envelope.payloadJson)
      expect(cache.get({ origin: 'https://other.test', schemaVersion: 3 })).toBeNull()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

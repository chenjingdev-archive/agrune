// Admin key model (Q3 / PLAN Phase 3) — a ROOT-SIGNED admin keyset.
//
// Trust topology (the deliberate choice, SPEC §5):
//   - Consumers pin ONE key: the ROOT (owner) public key.
//   - The root signs a KEYSET — the list of active admin public keys (+ a revoked list). The root is
//     used ONLY to (re)sign this keyset (grant/revoke), so it can live offline/cold/HSM — minimal
//     exposure, rarely rotated.
//   - Admins do the frequent work (sign manifests/scenarios). An admin key leak is recovered by the
//     root re-signing the keyset to revoke that one admin — WITHOUT consumers re-pinning anything.
//
// This file is ADDITIVE: the existing single-pinned-key `verifyEnvelope` (manifest-store.ts) is
// untouched and remains the inner gate. `verifyManifestWithKeyset` layers the keyset on top of it.

import {
  generateKeyPairSync,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  createHash,
  type KeyObject,
} from 'node:crypto'
import {
  parsePinnedKey,
  verifyEnvelope,
  type ManifestEnvelope,
  type VerifyResult,
} from './manifest-store.js'
import { verifyPayloadEnvelope, type PayloadVerifyResult } from './pack-store.js'

// ---- types -----------------------------------------------------------------

export interface AdminKeyEntry {
  /** Stable id = sha256(raw ed25519 public key)[:16]. */
  keyId: string
  /** The admin's public key: base64 raw 32-byte ed25519 (compact) or a PEM SPKI block. */
  publicKey: string
  label?: string
  addedAt?: string
}

/** The signed-keyset payload. Root signs the exact UTF-8 bytes of its JSON (same model as a manifest
 *  envelope: everything trusted is under the signature). */
export interface Keyset {
  version: 1
  /** The root public key (compact base64), informational — trust is the consumer's PINNED root. */
  root: string
  rootKeyId: string
  admins: AdminKeyEntry[]
  /** keyIds that are no longer trusted (revocation wins over presence in `admins`). */
  revoked: string[]
  updatedAt?: string
}

export interface KeysetEnvelope {
  payloadJson: string
  alg: 'ed25519'
  /** base64 ed25519 signature over the UTF-8 bytes of `payloadJson`, by the ROOT key. */
  signature: string
}

export type KeysetVerifyResult = { ok: true; keyset: Keyset } | { ok: false; reason: string }

// ---- key generation + identity ---------------------------------------------

export interface GeneratedKeyPair {
  keyId: string
  publicKeyPem: string
  privateKeyPem: string
  /** Compact base64 of the raw 32-byte ed25519 public key (for pinning / keyset entries). */
  publicKeyBase64: string
}

/** Generate an ed25519 keypair (the helper the PLAN's C3 surfaces; previously only in tests). */
export function generateKeyPair(): GeneratedKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    keyId: keyIdFor(publicKey),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyBase64: rawEd25519(publicKey).toString('base64'),
  }
}

/** Extract the raw 32-byte ed25519 public key from a KeyObject (SPKI DER minus the 12-byte prefix). */
function rawEd25519(key: KeyObject): Buffer {
  const der = key.export({ type: 'spki', format: 'der' }) as Buffer
  return der.subarray(der.length - 32)
}

/** Stable, short key identity: sha256 of the raw public key, first 16 hex chars. */
export function keyIdFor(key: KeyObject): string {
  return createHash('sha256').update(rawEd25519(key)).digest('hex').slice(0, 16)
}

/** The public key for a private/public KeyObject, as compact base64. */
export function publicKeyBase64(key: KeyObject): string {
  const pub = key.type === 'private' ? createPublicKey(key) : key
  return rawEd25519(pub).toString('base64')
}

// ---- keyset authoring (root side) ------------------------------------------

/** Build the initial keyset for a root key (no admins yet). */
export function emptyKeyset(rootPublicKey: KeyObject, updatedAt?: string): Keyset {
  return {
    version: 1,
    root: publicKeyBase64(rootPublicKey),
    rootKeyId: keyIdFor(rootPublicKey),
    admins: [],
    revoked: [],
    ...(updatedAt ? { updatedAt } : {}),
  }
}

/** Sign a keyset with the ROOT private key into a publishable envelope. */
export function signKeyset(keyset: Keyset, rootPrivateKey: KeyObject): KeysetEnvelope {
  const payloadJson = JSON.stringify(keyset)
  const signature = cryptoSign(null, Buffer.from(payloadJson, 'utf8'), rootPrivateKey).toString('base64')
  return { payloadJson, alg: 'ed25519', signature }
}

/** Add (or replace) an admin entry. Pure: returns a new keyset. */
export function grantAdmin(keyset: Keyset, entry: AdminKeyEntry, updatedAt?: string): Keyset {
  const admins = keyset.admins.filter((a) => a.keyId !== entry.keyId).concat(entry)
  // granting un-revokes (root explicitly re-trusts this id)
  const revoked = keyset.revoked.filter((id) => id !== entry.keyId)
  return { ...keyset, admins, revoked, ...(updatedAt ? { updatedAt } : {}) }
}

/** Revoke an admin by keyId. Pure: returns a new keyset. Revocation wins over presence. */
export function revokeAdmin(keyset: Keyset, keyId: string, updatedAt?: string): Keyset {
  const revoked = keyset.revoked.includes(keyId) ? keyset.revoked : keyset.revoked.concat(keyId)
  return { ...keyset, revoked, ...(updatedAt ? { updatedAt } : {}) }
}

// ---- keyset verification (consumer / runtime side) -------------------------

/** Verify a keyset envelope against the PINNED root public key. */
export function verifyKeyset(envelope: unknown, rootKey: KeyObject | null): KeysetVerifyResult {
  if (!rootKey) return { ok: false, reason: 'no-root-key' }
  const env = (envelope ?? {}) as Partial<KeysetEnvelope>
  if (env.alg !== 'ed25519') return { ok: false, reason: env.alg ? 'unsupported-alg' : 'unsigned' }
  if (typeof env.payloadJson !== 'string' || typeof env.signature !== 'string') {
    return { ok: false, reason: 'unsigned' }
  }
  let good = false
  try {
    good = cryptoVerify(null, Buffer.from(env.payloadJson, 'utf8'), rootKey, Buffer.from(env.signature, 'base64'))
  } catch {
    good = false
  }
  if (!good) return { ok: false, reason: 'bad-signature' }

  let parsed: unknown
  try {
    parsed = JSON.parse(env.payloadJson)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const ks = parsed as Partial<Keyset>
  if (
    !ks ||
    typeof ks !== 'object' ||
    ks.version !== 1 ||
    !Array.isArray(ks.admins) ||
    !Array.isArray(ks.revoked) ||
    typeof ks.root !== 'string'
  ) {
    return { ok: false, reason: 'malformed' }
  }
  return { ok: true, keyset: ks as Keyset }
}

/** The trusted signer keys derived from a verified keyset: the root plus every non-revoked admin. */
export function activeSignerKeys(keyset: Keyset, rootKey: KeyObject): Map<string, KeyObject> {
  const trusted = new Map<string, KeyObject>()
  trusted.set(keyset.rootKeyId, rootKey) // the owner (root) may sign directly
  for (const a of keyset.admins) {
    if (keyset.revoked.includes(a.keyId)) continue
    const key = parsePinnedKey(a.publicKey)
    if (key) trusted.set(a.keyId, key)
  }
  return trusted
}

/**
 * The full runtime trust gate for the keyset model: verify the keyset against the pinned ROOT, then
 * verify the manifest envelope against the root or any ACTIVE admin. A revoked admin's signature is
 * rejected (untrusted-signer); a wrong/forged keyset is rejected (untrusted-keyset). Composes the
 * existing single-key `verifyEnvelope` per trusted key — no weaker path.
 */
export function verifyManifestWithKeyset(
  manifestEnvelope: unknown,
  rootKey: KeyObject | null,
  keysetEnvelope: unknown,
): VerifyResult {
  const ks = verifyKeyset(keysetEnvelope, rootKey)
  if (!ks.ok) return { ok: false, reason: 'untrusted-keyset', detail: ks.reason }
  const trusted = activeSignerKeys(ks.keyset, rootKey as KeyObject)
  for (const key of trusted.values()) {
    const r = verifyEnvelope(manifestEnvelope as ManifestEnvelope, key)
    if (r.ok) return r
    // A non-signature failure (invalid manifest, malformed, too-large, …) is definitive: the
    // signature already matched this key, so trying others can't help.
    if (r.reason !== 'bad-signature' && r.reason !== 'no-pinned-key') return r
  }
  return { ok: false, reason: 'untrusted-signer' }
}

/**
 * Keyset-aware trust gate for a GENERIC payload envelope (a site pack / scenario suite, C4/Phase 6):
 * verify the keyset under the pinned root, then verify the payload against the root or any active
 * admin. Same shape as `verifyManifestWithKeyset`, but returns the decoded payload untyped-checked —
 * the caller validates the pack's manifest + scenarios after the signature clears.
 */
export function verifyPayloadWithKeyset<T = unknown>(
  payloadEnvelope: unknown,
  rootKey: KeyObject | null,
  keysetEnvelope: unknown,
): PayloadVerifyResult<T> {
  const ks = verifyKeyset(keysetEnvelope, rootKey)
  if (!ks.ok) return { ok: false, reason: 'untrusted-keyset', detail: ks.reason }
  const trusted = activeSignerKeys(ks.keyset, rootKey as KeyObject)
  for (const key of trusted.values()) {
    const r = verifyPayloadEnvelope<T>(payloadEnvelope, key)
    if (r.ok) return r
    if (r.reason !== 'bad-signature' && r.reason !== 'no-pinned-key') return r
  }
  return { ok: false, reason: 'untrusted-signer' }
}

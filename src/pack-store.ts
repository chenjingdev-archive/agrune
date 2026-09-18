// Site-pack store (C4 + C5 / PLAN Phase 6).
//
// C4 — the §12 signed envelope, generalized to ANY pure-data payload (scenarios, packs), not just
// manifests. `signPayload`/`verifyPayloadEnvelope` are the manifest envelope's sibling: same ed25519
// sign-the-exact-bytes model, but they do NOT validate a manifest schema (a site pack carries a
// manifest AND scenarios; the consumer validates each with the right validator after the signature
// clears). The signature is the trust; schema validation is the caller's.
//
// C5 — a store INDEX: enumerate the packs a dir store holds so a catalog front-end can discover them.
// The dir store is static (a server over the root IS the store); the index is a generated listing.

import { sign as cryptoSign, verify as cryptoVerify, createHash, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import type { ManifestProvenance, VerifyFailReason } from './manifest-store.js'

const MAX_PAYLOAD_CHARS = 8 * 1024 * 1024

// ---- generic signed envelope (C4) ------------------------------------------

export interface SignedEnvelope {
  payloadJson: string
  alg: 'ed25519'
  signature: string
}

export interface PayloadVerified<T = unknown> {
  data: T
  provenance: ManifestProvenance
  contentHash: string
  keyId?: string
}

export type PayloadVerifyResult<T = unknown> =
  | { ok: true; value: PayloadVerified<T> }
  | { ok: false; reason: VerifyFailReason; detail?: string }

interface SignedPayloadShape {
  data: unknown
  meta?: ManifestProvenance
  keyId?: string
}

/** Sign an arbitrary pure-data payload into a publishable envelope (everything trusted is under the
 *  signature — symmetric with verifyPayloadEnvelope). */
export function signPayload(
  data: unknown,
  meta: ManifestProvenance | undefined,
  privateKey: KeyObject,
  keyId?: string,
): SignedEnvelope {
  const payload: SignedPayloadShape = { data, ...(meta ? { meta } : {}), ...(keyId ? { keyId } : {}) }
  const payloadJson = JSON.stringify(payload)
  const signature = cryptoSign(null, Buffer.from(payloadJson, 'utf8'), privateKey).toString('base64')
  return { payloadJson, alg: 'ed25519', signature }
}

/** Verify a generic payload envelope against a single key. Returns the decoded `data` UNTYPED-checked
 *  — the caller validates its schema (manifest / scenario) after the signature clears. */
export function verifyPayloadEnvelope<T = unknown>(envelope: unknown, key: KeyObject | null): PayloadVerifyResult<T> {
  if (!key) return { ok: false, reason: 'no-pinned-key' }
  const env = (envelope ?? {}) as Partial<SignedEnvelope>
  if (env.alg !== 'ed25519') {
    return env.alg ? { ok: false, reason: 'unsupported-alg', detail: String(env.alg) } : { ok: false, reason: 'unsigned' }
  }
  if (typeof env.payloadJson !== 'string' || typeof env.signature !== 'string') {
    return { ok: false, reason: 'unsigned' }
  }
  if (env.payloadJson.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: 'too-large' }

  const data = Buffer.from(env.payloadJson, 'utf8')
  let good = false
  try {
    good = cryptoVerify(null, data, key, Buffer.from(env.signature, 'base64'))
  } catch {
    good = false
  }
  if (!good) return { ok: false, reason: 'bad-signature' }

  let payload: unknown
  try {
    payload = JSON.parse(env.payloadJson)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'malformed' }
  }
  const p = payload as Partial<SignedPayloadShape>
  return {
    ok: true,
    value: {
      data: p.data as T,
      provenance: sanitizeProvenance(p.meta),
      contentHash: createHash('sha256').update(data).digest('hex'),
      ...(typeof p.keyId === 'string' ? { keyId: p.keyId } : {}),
    },
  }
}

function sanitizeProvenance(raw: unknown): ManifestProvenance {
  if (!raw || typeof raw !== 'object') return {}
  const r = raw as Record<string, unknown>
  const out: ManifestProvenance = {}
  if (typeof r.origin === 'string') out.origin = r.origin
  if (typeof r.appVersion === 'string') out.appVersion = r.appVersion
  if (typeof r.schemaVersion === 'number') out.schemaVersion = r.schemaVersion
  if (typeof r.publishedAt === 'string') out.publishedAt = r.publishedAt
  if (r.author === 'human' || r.author === 'agent') out.author = r.author
  return out
}

// ---- pack store + index (C5) -----------------------------------------------

export interface PackAddress {
  origin: string
  version: string
}

/** `<root>/<enc(origin)>/<enc(version)>/pack.json`. */
export function packStorePathFor(root: string, addr: PackAddress): string {
  return join(root, encodeURIComponent(addr.origin), encodeURIComponent(addr.version), 'pack.json')
}

/** Publish a signed pack envelope to the dir store. Returns the written path. */
export function publishPackToDir(root: string, addr: PackAddress, envelope: SignedEnvelope): string {
  const path = packStorePathFor(root, addr)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(envelope, null, 2))
  return path
}

export interface StoreIndexEntry {
  origin: string
  version: string
  /** Store-root-relative path to the pack envelope. */
  path: string
}

export interface StoreIndex {
  packs: StoreIndexEntry[]
  generatedAt?: string
}

/** Enumerate the packs a dir store holds: scan `<root>/<origin>/<version>/pack.json`. */
export function scanStore(root: string): StoreIndexEntry[] {
  const entries: StoreIndexEntry[] = []
  if (!existsSync(root)) return entries
  for (const originDir of safeReaddir(root)) {
    const originPath = join(root, originDir)
    if (!isDir(originPath)) continue
    for (const versionDir of safeReaddir(originPath)) {
      const packPath = join(originPath, versionDir, 'pack.json')
      if (!existsSync(packPath)) continue
      entries.push({
        origin: decode(originDir),
        version: decode(versionDir),
        path: `${originDir}/${versionDir}/pack.json`,
      })
    }
  }
  // Stable order: origin, then version.
  return entries.sort((a, b) => a.origin.localeCompare(b.origin) || a.version.localeCompare(b.version))
}

/** Write `<root>/index.json` enumerating the store's packs (the C5 "index endpoint"). */
export function writeStoreIndex(root: string, generatedAt?: string): string {
  const index: StoreIndex = { packs: scanStore(root), ...(generatedAt ? { generatedAt } : {}) }
  const path = join(root, 'index.json')
  mkdirSync(root, { recursive: true })
  writeFileSync(path, JSON.stringify(index, null, 2))
  return path
}

export function readStoreIndex(root: string): StoreIndex | null {
  const path = join(root, 'index.json')
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as StoreIndex
  } catch {
    return null
  }
}

function safeReaddir(p: string): string[] {
  try {
    return readdirSync(p)
  } catch {
    return []
  }
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

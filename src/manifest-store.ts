// Manifest store client (§12.2) — the SECURITY backbone of the manifest lifecycle.
//
// A remote manifest is a code-injection surface: `keyFrom`/`nameFrom` are page-authored JS strings
// compiled with `new Function` (§3.11.4). So a store artifact is TRUSTED only when it carries a
// valid ed25519 signature from a PINNED public key (AGRUNE_MANIFEST_STORE_KEY). Unsigned, wrong-key,
// tampered, or unpinned artifacts are REJECTED — never parsed-as-trusted, never swapped in. This
// module is pure + transport-injected so the trust decision can be tested adversarially with no
// network. Wiring (source chain + drift-driven swap) lives in B1b.
//
// Signing model — EVERYTHING TRUSTED IS UNDER THE SIGNATURE. The envelope ships one signed string,
// `payloadJson`, whose UTF-8 bytes are exactly what the signature covers, and which decodes to
// `{ manifest, meta?, keyId? }`. Signing the exact bytes (not a re-serialization) sidesteps JSON
// canonicalization ambiguity, and putting manifest + provenance + keyId all inside the signed
// payload means a MITM cannot forge provenance or inject type-confused fields onto a result we then
// label "verified" — the ONLY fields outside the signature are `alg` and `signature` themselves,
// which are verification machinery, not trusted data.

import {
  createPublicKey,
  createPrivateKey,
  verify as cryptoVerify,
  sign as cryptoSign,
  createHash,
  type KeyObject,
} from 'node:crypto'
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import http from 'node:http'
import https from 'node:https'
import { validateManifest, type AgruneManifest } from './manifest.js'

// A signed manifest is small (KB). These caps bound the work an attacker/compromised store can
// force before the trust gate even runs.
const MAX_BODY_BYTES = 4 * 1024 * 1024
const MAX_PAYLOAD_CHARS = 4 * 1024 * 1024
const IDLE_TIMEOUT_MS = 8000
const DEADLINE_MS = 10_000

// ---- types -----------------------------------------------------------------

/** A signed manifest as published to the store. */
export interface ManifestEnvelope {
  /** The EXACT signed bytes, UTF-8 JSON, decoding to `SignedPayload`. The signature covers this. */
  payloadJson: string
  alg: 'ed25519'
  /** base64 ed25519 signature over the UTF-8 bytes of `payloadJson`. */
  signature: string
}

/** What `payloadJson` decodes to — all of it under the signature. */
export interface SignedPayload {
  manifest: unknown
  meta?: ManifestProvenance
  /** Informational key identifier (trust comes from the pinned key, not this). */
  keyId?: string
}

export interface ManifestProvenance {
  origin?: string
  appVersion?: string
  schemaVersion?: number
  publishedAt?: string
  author?: 'human' | 'agent'
}

export interface VerifiedManifest {
  manifest: AgruneManifest
  /** Signed provenance (under the signature), sanitized to declared types. */
  provenance: ManifestProvenance
  /** sha256 of the signed bytes — the content hash used for caching + addressing. */
  contentHash: string
  keyId?: string
}

export type VerifyFailReason =
  | 'no-pinned-key' // AGRUNE_MANIFEST_STORE_KEY unset/unparseable → refuse to trust anything
  | 'unsigned' // envelope missing signature/alg/payloadJson
  | 'unsupported-alg' // alg present but not ed25519
  | 'too-large' // payload exceeds the size cap (parse-amplification guard)
  | 'bad-signature' // ed25519 verify failed → tampered or signed by a non-pinned key
  | 'malformed' // payloadJson is not parseable / not a SignedPayload object
  | 'invalid-manifest' // failed validateManifest (schema / forbidden-selector / keyFrom gates)

export type VerifyResult =
  | { ok: true; value: VerifiedManifest }
  | { ok: false; reason: VerifyFailReason; detail?: string }

// ---- pinned-key parsing ----------------------------------------------------

// SPKI DER prefix for an Ed25519 public key: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING }.
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function ed25519SpkiDer(raw32: Buffer): Buffer {
  return Buffer.concat([ED25519_SPKI_PREFIX, raw32])
}

/**
 * Parse the pinned public key from AGRUNE_MANIFEST_STORE_KEY. Accepts, in order:
 *   - a PEM (SPKI) public key (contains "BEGIN"),
 *   - a path to a PEM file,
 *   - a base64 raw 32-byte Ed25519 public key (compact form).
 * Rejects (→ null) anything that is not an Ed25519 key, so an operator who pins an RSA/EC key fails
 * CLOSED and clearly (null key → every fetch is rejected) rather than failing obscurely at verify.
 */
export function parsePinnedKey(spec: string | undefined): KeyObject | null {
  if (!spec || spec.trim().length === 0) return null
  let material = spec.trim()
  if (!material.includes('BEGIN') && material.length < 4096 && existsSync(material)) {
    try {
      material = readFileSync(material, 'utf8').trim()
    } catch {
      return null
    }
  }
  try {
    let key: KeyObject
    if (material.includes('BEGIN')) {
      key = createPublicKey(material)
    } else {
      const raw = Buffer.from(material, 'base64')
      if (raw.length !== 32) return null
      key = createPublicKey({ key: ed25519SpkiDer(raw), format: 'der', type: 'spki' })
    }
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

// ---- the load-bearing verify ----------------------------------------------

function sha256Hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

/** Coerce an untrusted-typed (even if signed) provenance object to its declared types. */
function sanitizeProvenance(raw: unknown): ManifestProvenance {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const r = raw as Record<string, unknown>
  const out: ManifestProvenance = {}
  if (typeof r.origin === 'string') out.origin = r.origin
  if (typeof r.appVersion === 'string') out.appVersion = r.appVersion
  if (typeof r.schemaVersion === 'number' && Number.isFinite(r.schemaVersion)) out.schemaVersion = r.schemaVersion
  if (typeof r.publishedAt === 'string') out.publishedAt = r.publishedAt
  if (r.author === 'human' || r.author === 'agent') out.author = r.author
  return out
}

/**
 * Verify a store envelope against the pinned key. The trust gate. Order is deliberate: refuse if no
 * pinned key, size-guard, check the signature over the received bytes, and ONLY THEN parse the
 * signed payload + validate. Untrusted bytes are never treated as a trusted manifest, and every
 * field of the returned VerifiedManifest comes from inside the signature.
 */
export function verifyEnvelope(envelope: unknown, pinnedKey: KeyObject | null): VerifyResult {
  if (!pinnedKey) return { ok: false, reason: 'no-pinned-key' }
  const env = (envelope ?? {}) as Partial<ManifestEnvelope>

  if (env.alg !== 'ed25519') {
    return env.alg
      ? { ok: false, reason: 'unsupported-alg', detail: String(env.alg) }
      : { ok: false, reason: 'unsigned' }
  }
  if (typeof env.payloadJson !== 'string' || typeof env.signature !== 'string') {
    return { ok: false, reason: 'unsigned' }
  }
  if (env.payloadJson.length > MAX_PAYLOAD_CHARS) return { ok: false, reason: 'too-large' }

  const data = Buffer.from(env.payloadJson, 'utf8')
  const sig = Buffer.from(env.signature, 'base64')
  let good = false
  try {
    // Ed25519/Ed448 require the algorithm argument to be null.
    good = cryptoVerify(null, data, pinnedKey, sig)
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
  const p = payload as Partial<SignedPayload>

  const validated = validateManifest(p.manifest)
  if (!validated.ok) {
    return { ok: false, reason: 'invalid-manifest', detail: validated.errors[0]?.message }
  }

  return {
    ok: true,
    value: {
      manifest: validated.manifest,
      provenance: sanitizeProvenance(p.meta),
      contentHash: sha256Hex(data),
      ...(typeof p.keyId === 'string' ? { keyId: p.keyId } : {}),
    },
  }
}

// ---- addressing ------------------------------------------------------------

export interface ManifestAddress {
  origin: string
  schemaVersion?: number
  appVersion?: string
}

/** `<base>/<origin>/<schemaVersion>[/<appVersion>]/manifest.json`. */
export function manifestUrl(storeBase: string, addr: ManifestAddress): string {
  const base = storeBase.replace(/\/+$/, '')
  const parts = [encodeURIComponent(addr.origin), String(addr.schemaVersion ?? 3)]
  if (addr.appVersion) parts.push(encodeURIComponent(addr.appVersion))
  return `${base}/${parts.join('/')}/manifest.json`
}

// ---- transport (injectable) ------------------------------------------------

export interface TransportResponse {
  status: number
  body: string
  headers: Record<string, string | undefined>
}
export type Transport = (url: string, headers: Record<string, string>) => Promise<TransportResponse>

/**
 * Default transport with three independent safety bounds so a malicious/compromised store cannot
 * stall or OOM the run: a hard body-size cap, an absolute deadline (defeats slow-drip), and a
 * secondary idle timeout. Any of them aborts the request → the promise rejects → the caller turns
 * it into a structured `network` non-ok result and leaves the existing manifest in place.
 *
 * Scheme-dispatched (http for localhost/testing, https otherwise). Plain http is acceptable here
 * because the TRUST anchor is the ed25519 signature, not TLS: over http a MITM can only deny or
 * replay (both fail-closed to "keep the existing manifest"), never forge a manifest we'd execute.
 */
const nodeTransport: Transport = (url, headers) =>
  new Promise((resolve, reject) => {
    let settled = false
    let deadline: NodeJS.Timeout
    const settle = (fn: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      fn()
    }

    const get = url.startsWith('http://') ? http.get : https.get
    const req = get(url, { headers }, (res) => {
      const chunks: Buffer[] = []
      let total = 0
      res.on('data', (c: Buffer) => {
        total += c.length
        if (total > MAX_BODY_BYTES) {
          req.destroy()
          settle(() => reject(new Error('manifest store response too large')))
          return
        }
        chunks.push(c)
      })
      res.on('error', (e) => {
        req.destroy()
        settle(() => reject(e))
      })
      res.on('end', () =>
        settle(() =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers as Record<string, string | undefined>,
          }),
        ),
      )
    })

    deadline = setTimeout(() => {
      req.destroy()
      settle(() => reject(new Error('manifest store fetch deadline')))
    }, DEADLINE_MS)
    req.on('error', (e) => settle(() => reject(e)))
    req.setTimeout(IDLE_TIMEOUT_MS, () => {
      req.destroy()
      settle(() => reject(new Error('manifest store idle timeout')))
    })
  })

// ---- fetch-latest ----------------------------------------------------------

export interface FetchOptions {
  storeBase: string
  pinnedKey: KeyObject | null
  addr: ManifestAddress
  /** Send `If-None-Match`; a 304 means the cached copy is still current. */
  knownEtag?: string
  transport?: Transport
}

export type FetchResult =
  | { ok: true; value: VerifiedManifest; etag?: string }
  | { ok: false; reason: 'not-modified' }
  | { ok: false; reason: 'http'; status: number }
  | { ok: false; reason: 'network'; detail: string }
  | { ok: false; reason: VerifyFailReason; detail?: string }

/**
 * Fetch the latest manifest for an address and return it ONLY if it verifies. Any failure
 * (network, http, untrusted) returns a structured non-ok result so the caller leaves the existing
 * (page-injected) manifest in place and surfaces drift instead of swapping in something unproven.
 */
export async function fetchLatestManifest(opts: FetchOptions): Promise<FetchResult> {
  const transport = opts.transport ?? nodeTransport
  const url = manifestUrl(opts.storeBase, opts.addr)
  const headers: Record<string, string> = { accept: 'application/json' }
  if (opts.knownEtag) headers['if-none-match'] = opts.knownEtag

  let res: TransportResponse
  try {
    res = await transport(url, headers)
  } catch (e) {
    return { ok: false, reason: 'network', detail: String(e) }
  }
  if (res.status === 304) return { ok: false, reason: 'not-modified' }
  if (res.status < 200 || res.status >= 300) return { ok: false, reason: 'http', status: res.status }
  if (res.body.length > MAX_BODY_BYTES) return { ok: false, reason: 'too-large' }

  let envelope: unknown
  try {
    envelope = JSON.parse(res.body)
  } catch {
    return { ok: false, reason: 'malformed' }
  }
  const verified = verifyEnvelope(envelope, opts.pinnedKey)
  if (!verified.ok) return verified

  const etag = res.headers['etag']
  return { ok: true, value: verified.value, ...(etag ? { etag } : {}) }
}

// ---- config ----------------------------------------------------------------

export interface ManifestStoreConfig {
  /** True only when a store base URL is configured. */
  enabled: boolean
  storeBase?: string
  /** Null when AGRUNE_MANIFEST_STORE_KEY is unset/unparseable → store fetches will be rejected. */
  pinnedKey: KeyObject | null
}

export function loadManifestStoreConfig(env: NodeJS.ProcessEnv = process.env): ManifestStoreConfig {
  const storeBase = env.AGRUNE_MANIFEST_STORE?.trim()
  const pinnedKey = parsePinnedKey(env.AGRUNE_MANIFEST_STORE_KEY)
  return {
    enabled: Boolean(storeBase && storeBase.length > 0),
    ...(storeBase ? { storeBase } : {}),
    pinnedKey,
  }
}

// ---- local cache (content-addressed) ---------------------------------------

export interface CacheEntry {
  etag?: string
  contentHash: string
  /** The verified envelope, re-fetchable without the network. The cache confers NO trust: a reader
   *  MUST re-run verifyEnvelope on the stored envelope before using it. */
  envelope: ManifestEnvelope
}

export function defaultManifestCacheDir(): string {
  return join(homedir(), '.agrune', 'manifest-cache')
}

/**
 * A tiny on-disk cache keyed by (origin, schemaVersion). Stores the verified envelope + its ETag so
 * the runtime can short-circuit a re-fetch with `If-None-Match` and re-verify from disk on restart.
 * Re-verification on read is the caller's job — the cache never confers trust by itself.
 */
export class ManifestCache {
  constructor(private readonly dir: string = defaultManifestCacheDir()) {}

  private file(addr: ManifestAddress): string {
    const key = sha256Hex(Buffer.from(`${addr.origin}\t${addr.schemaVersion ?? 3}`, 'utf8')).slice(0, 24)
    return join(this.dir, `${key}.json`)
  }

  get(addr: ManifestAddress): CacheEntry | null {
    try {
      return JSON.parse(readFileSync(this.file(addr), 'utf8')) as CacheEntry
    } catch {
      return null
    }
  }

  put(addr: ManifestAddress, entry: CacheEntry): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      writeFileSync(this.file(addr), JSON.stringify(entry, null, 2))
    } catch {
      /* a cache write failure must never break the run */
    }
  }
}

// ---- publish side (§12.4 repair harness) -----------------------------------
//
// The inverse of the verify path: SIGN a manifest into a publishable envelope, and PUBLISH it to a
// directory the store serves. By construction `verifyEnvelope(signManifest(m, …), pub) === m`, so
// the repair harness can only publish artifacts that will pass the exact same trust gate the
// runtime applies on fetch — there is no separate, weaker publish path.

/** Parse a signing PRIVATE key (PEM or path). Ed25519 only → null otherwise (fail closed). */
export function parseSigningKey(spec: string | undefined): KeyObject | null {
  if (!spec || spec.trim().length === 0) return null
  let material = spec.trim()
  if (!material.includes('BEGIN') && material.length < 4096 && existsSync(material)) {
    try {
      material = readFileSync(material, 'utf8').trim()
    } catch {
      return null
    }
  }
  try {
    const key = createPrivateKey(material)
    return key.asymmetricKeyType === 'ed25519' ? key : null
  } catch {
    return null
  }
}

/**
 * Sign a manifest into a publishable envelope. Everything trusted (manifest + provenance + keyId)
 * goes UNDER the signature — symmetric with verifyEnvelope, which is the only consumer.
 */
export function signManifest(
  manifest: AgruneManifest,
  meta: ManifestProvenance | undefined,
  privateKey: KeyObject,
  keyId?: string,
): ManifestEnvelope {
  const payload: SignedPayload = {
    manifest,
    ...(meta ? { meta } : {}),
    ...(keyId ? { keyId } : {}),
  }
  const payloadJson = JSON.stringify(payload)
  const signature = cryptoSign(null, Buffer.from(payloadJson, 'utf8'), privateKey).toString('base64')
  return { payloadJson, alg: 'ed25519', signature }
}

/** Filesystem path under a publish root mirroring `manifestUrl` — a static server over the root IS
 *  the store. `<root>/<encodeURIComponent(origin)>/<schemaVersion>[/<appVersion>]/manifest.json`. */
export function storePathFor(root: string, addr: ManifestAddress): string {
  const parts = [root, encodeURIComponent(addr.origin), String(addr.schemaVersion ?? 3)]
  if (addr.appVersion) parts.push(encodeURIComponent(addr.appVersion))
  return join(...parts, 'manifest.json')
}

/** Publish a signed envelope to the dir store. Returns the written path. */
export function publishToDir(root: string, addr: ManifestAddress, envelope: ManifestEnvelope): string {
  const path = storePathFor(root, addr)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(envelope, null, 2))
  return path
}

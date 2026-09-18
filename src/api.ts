// Programmatic execution API (SPEC §6, PLAN C1).
//
// The importable surface a PERSON-facing tool (Studio) uses to DRIVE the engine deterministically:
// launch/attach a browser, resolve manifest refs to elements, perform manifest-addressed actions,
// and read the run-result signals (changed-bit + console + network). The CLI/daemon are one
// consumer of this surface; the Studio scenario runner is another — neither re-implements the
// engine. The manifest truth is re-exported too so a consumer needs a single import.

// ---- the driver ------------------------------------------------------------
export { BrowserSession } from './browser-session.js'
export type { ClickOptions } from './browser-session.js'
export type { FillStrategy } from './actions.js'

// ---- resolve (manifest ref → Playwright Locator) ---------------------------
export {
  resolveTargetLocator,
  resolveTargetOrSelectorLocator,
  loadManifestFromPage,
  findTargetLocator,
  manifestDeclaresTarget,
} from './resolver.js'
export type { ResolveOptions, SelfHealHook, ResolvedLocator, LocatorScope } from './resolver.js'

// ---- perception (snapshots — the basis for declarative assertions) ---------
export {
  buildSnapshotFromManifest,
  refreshSnapshot,
  createSnapshotStore,
  filterSnapshot,
  formatSnapshot,
  ariaSnapshot,
} from './snapshot.js'
export type {
  PageSnapshot,
  PageTarget,
  PageSnapshotGroup,
  PageTargetReason,
  SnapshotStore,
  SnapshotTargetFilterOptions,
} from './snapshot.js'

// ---- run-result signals ----------------------------------------------------
export type { ActionInsights } from './plugins/feedback.js'

// ---- drift detection (C2 / Phase 2) ----------------------------------------
export { detectManifestDrift, updateDriftBaseline, formatDriftNotice } from './plugins/drift.js'
export type { GroupDrift, DriftReport, DriftOptions } from './plugins/drift.js'

// ---- repair gate + loop (C2 / Phase 2): propose → verify → publish ---------
export { mergeManifestPatch, verifyRepair, runRepair } from './repair.js'
export type {
  TargetPatch,
  RepairOracle,
  RepairVerdict,
  RepairResult,
  DriftedTarget,
  ProposeSelector,
  RepairRequest,
  RepairOutcome,
} from './repair.js'

// ---- target-ref grammar (repeat keys: posts[key=abc].like_btn) -------------
export {
  normalizeAgentTargetId,
  toAgentTargetRef,
  parseRepeatedTargetId,
  REPEATED_TARGET_KEY_DELIMITER,
  AgentTargetIdParseError,
} from './target-ref.js'

// ---- shared result/value shapes --------------------------------------------
export type {
  PublicTab,
  FillFormField,
  ConsoleLevel,
  ConsoleMessageEntry,
  NetworkRequestPart,
  NetworkRequestSummary,
  DialogInfo,
  FileChooserInfo,
} from './types.js'

// ---- signing / publishing / verification (C3 / Phase 3) --------------------
export {
  signManifest,
  verifyEnvelope,
  parsePinnedKey,
  parseSigningKey,
  publishToDir,
  storePathFor,
  manifestUrl,
} from './manifest-store.js'
export type {
  ManifestEnvelope,
  SignedPayload,
  ManifestProvenance,
  VerifiedManifest,
  VerifyResult,
  VerifyFailReason,
  ManifestAddress,
} from './manifest-store.js'

// ---- key & admin model (Q3 / Phase 3): root-signed admin keyset ------------
export {
  generateKeyPair,
  keyIdFor,
  publicKeyBase64,
  emptyKeyset,
  signKeyset,
  grantAdmin,
  revokeAdmin,
  verifyKeyset,
  activeSignerKeys,
  verifyManifestWithKeyset,
} from './keyset.js'
export type { AdminKeyEntry, Keyset, KeysetEnvelope, KeysetVerifyResult, GeneratedKeyPair } from './keyset.js'
export { verifyPayloadWithKeyset } from './keyset.js'

// ---- site-pack store: generic signed envelope + store index (C4 + C5 / Phase 6) ------
export {
  signPayload,
  verifyPayloadEnvelope,
  packStorePathFor,
  publishPackToDir,
  scanStore,
  writeStoreIndex,
  readStoreIndex,
} from './pack-store.js'
export type {
  SignedEnvelope,
  PayloadVerified,
  PayloadVerifyResult,
  PackAddress,
  StoreIndexEntry,
  StoreIndex,
} from './pack-store.js'

// ---- manifest truth (schema/validator/types) — re-exported from @agrune/manifest -----
export * from './manifest.js'

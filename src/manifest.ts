// Manifest truth — re-export shim (SPEC §6, PLAN Phase 0 / C0).
//
// The schema/validator/selector-policy USED to live here. It now lives in the shared
// `@agrune/manifest` package so the core, Studio, and the demo all stand on ONE source — a
// duplicate validator is the drift this consolidation removes. This file stays as the in-repo
// import path (`./manifest.js`) every other core module already uses; it adds nothing of its own.
export * from '@agrune/manifest'

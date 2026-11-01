# Agrune scenario domain

`agrune.scenario/v1` is a strict, data-only QA format built around manifest target references.

The domain owns:

- the closed action and assertion vocabularies;
- strict validation (including unknown-field rejection);
- deterministic JSON serialization;
- `secretRef`-only sensitive fill support;
- editor-safe descriptions and dependency extraction;
- a thin runner over Agrune's current public `BrowserSession` surface.

It deliberately does not own browser launch/lifetime, selector resolution, screenshots, traces, retries, or CI reporting. The host starts one Agrune `BrowserSession` (or provides an equivalent daemon adapter), then passes it to `runScenario`. This keeps the daemon/Studio as the single session owner and leaves browser mechanics in Agrune/Playwright.

## File format

```json
{
  "schema": "agrune.scenario/v1",
  "id": "login-smoke",
  "name": "Login smoke test",
  "manifest": {
    "schemaVersion": 3,
    "origin": "https://app.example.com"
  },
  "url": "https://app.example.com/login",
  "steps": [
    { "do": "fill", "ref": "login.email", "value": "qa@example.com" },
    { "do": "fill", "ref": "login.password", "secretRef": "qa.login.password" },
    { "do": "click", "ref": "login.submit" },
    { "assert": "urlContains", "value": "/home" },
    { "assert": "noConsoleErrors" }
  ]
}
```

`fill` accepts exactly one of `value` and `secretRef`. A secret is resolved only immediately before the browser call. The resolved value is never stored in the document, summary, event, report, or error. Runtime details from a failed secret fill or secret resolver are suppressed because either boundary may echo sensitive material. The runner also rejects an inline `value` when the resolved manifest target is marked sensitive.

## Current integration boundary

The runner is structurally compatible with the current public `BrowserSession` methods and can execute now. One pinning gap remains explicit: `PageSnapshot` exposes `schemaVersion` but not the manifest's application version/provenance. Therefore a scenario with `manifest.appVersion` requires the host to provide `verifyManifestPin`; without one, the run fails with `MANIFEST_PIN_UNVERIFIABLE` rather than silently ignoring the pin.

Cancellation is cooperative between steps. Pausing and single-stepping are host orchestration concerns; `executeScenarioStep` is exported as the primitive for a Studio controller.

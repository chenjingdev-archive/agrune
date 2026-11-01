# Agrune Studio

Agrune Studio is a local semantic QA workbench for authoring, running, and diagnosing strict `agrune.scenario/v1` flows over Agrune manifest targets.

The tested application stays in a real headed Chromium window. Studio does not embed the page or stream a screenshot mirror; it shows the scenario, semantic run timeline, manifest perception and resolution, diagnostics, and captured evidence around that browser session.

## What works now

- one Studio-owned headed Agrune `BrowserSession`;
- built-in starter scenarios and workspace scenario files;
- a structured Builder and canonical JSON editor;
- manifest-ref actions and a closed declarative assertion vocabulary;
- strict validation before save or run, with no arbitrary JavaScript steps;
- run, pause, resume, semantic single-step, stop, and human takeover controls;
- target focus and highlight in the real Chromium window;
- perception, resolution, activity, console, and network inspection;
- first-failure stop with remaining steps marked skipped;
- a private per-run JSON log, Playwright trace capture, and a failure screenshot for configured workspaces.

## Run locally

Install dependencies and the Playwright Chromium runtime, then start Studio:

```bash
pnpm install
pnpm browser:install
pnpm dev
```

The built-in examples target the sibling demo at `http://127.0.0.1:4178`:

```bash
pnpm --dir ../demo dev --host 127.0.0.1 --port 4178
```

Use **Open workspace** in Studio to select the project whose scenarios and evidence you want to manage. In a packaged build, Studio starts from an app-owned sample location and never silently treats Documents or the home directory as a writable workspace.

## Configure a workspace

The recommended workspace descriptor is `<workspace>/.agrune/workspace.json`:

```json
{
  "schema": "agrune.workspace/v1",
  "root": "/absolute/path/to/project",
  "baseUrl": "http://127.0.0.1:4178",
  "manifestPath": "manifest.json",
  "scenarioDir": ".agrune/scenarios",
  "artifactDir": ".agrune/artifacts"
}
```

`root` must be absolute. The manifest, scenario, and artifact paths are workspace-relative and cannot escape the workspace through `..`, absolute child paths, or symlinks. Scenario writes use atomic replacement.

If the descriptor is absent, an explicitly selected folder opens with in-memory defaults. Scenario files can be written beneath `.agrune/scenarios`, but run-log, trace, and failure-screenshot capture remain disabled until the workspace descriptor exists. An invalid descriptor is shown as a workspace issue and file writes fail closed rather than falling back to a different path.

Workspace scenario files are discovered recursively beneath `scenarioDir`. New files use the canonical `*.agrune.json` suffix.

## Author a scenario

Builder and JSON mode edit the same canonical document. A minimal scenario looks like this:

```json
{
  "schema": "agrune.scenario/v1",
  "id": "checkout-smoke",
  "name": "Checkout smoke test",
  "manifest": {
    "schemaVersion": 3,
    "origin": "https://shop.example.com"
  },
  "url": "https://shop.example.com/checkout",
  "steps": [
    {
      "do": "fill",
      "ref": "checkout.email",
      "value": "qa@example.com"
    },
    {
      "do": "click",
      "ref": "checkout.submit"
    },
    {
      "assert": "urlContains",
      "value": "/complete"
    },
    {
      "assert": "noConsoleErrors"
    }
  ]
}
```

Interactive actions address manifest target refs. Assertions are a closed vocabulary over URL, title, text, target state, repeat counts, console errors, and network status. Unknown fields and verbs are rejected.

The domain format supports `secretRef`, but Studio does not yet have a vault resolver. Builder preserves existing secret references and marks them as not executable; use literal values only for non-sensitive test data until a resolver is connected. Non-editor summaries redact literal fill/type contents to length-only placeholders.

See [the scenario-domain guide](./src/scenario/README.md) for the complete ownership and validation model.

## Run and diagnose

1. Open the real browser from Studio.
2. Run a whole scenario or use **Step** to execute one semantic step and pause.
3. Follow the live timeline and the currently active target.
4. Inspect **Perception** for the manifest snapshot, **Resolution** for the target lookup result, and **Evidence** for diagnostics and artifacts.
5. On failure, edit the exact draft that was executed and replay it. Unsaved draft state is kept separate from persisted scenario files.

**Take over** pauses an active run at a semantic boundary and brings Chromium forward for direct interaction. It does not record human actions or automatically update the scenario.

## Evidence

For a configured workspace, each run writes beneath:

```text
.agrune/artifacts/runs/<run-id>/
├── run.json      # status, steps, timeline, console, network, and artifact index
├── trace.zip
└── failure.png   # failed runs only
```

All three artifact files are restricted to the current user with `0600` permissions; `run.json` is also written through atomic replacement. Console and network signals remain visible in the current Studio session and are copied into that run log. The Studio artifact list itself is currently in-memory; the files remain on disk, but Studio does not yet rebuild a persistent run catalog or provide an embedded Trace Viewer after restart.

Run logs, Playwright traces, and screenshots can contain sensitive page content. Review every artifact before sharing it.

## Architecture

```text
React Studio workbench
  ├─ scenario library + Builder/JSON editor
  ├─ semantic run timeline and controls
  └─ perception / resolution / evidence inspector
        ↕ narrow typed contextBridge API
Electron main
  └─ StudioController
      ├─ WorkspaceStore
      │   ├─ .agrune/workspace.json
      │   ├─ .agrune/scenarios/*.agrune.json
      │   └─ .agrune/artifacts/runs/<run-id>/
      └─ one Agrune BrowserSession (headed)
          └─ real external Playwright Chromium window
              ├─ manifest snapshot and target resolution
              ├─ browser actions and assertions
              ├─ target highlights
              └─ console, network, trace, and screenshot signals
```

The Electron main process owns browser and filesystem authority. The sandboxed renderer receives structured state and a narrow command API. Manifest parsing, target resolution, and browser mechanics stay in Agrune and Playwright rather than being reimplemented in Studio.

## Verify and package

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm make
```

`pnpm package` and `pnpm make` install the Playwright Chromium runtime beneath `playwright-core/.local-browsers` and copy it into the packaged application's resources, so packaged runs do not depend on a separately installed system browser.

## Current limits

- Studio has no connected secret vault resolver yet.
- `manifest.appVersion` pins require host provenance support that the current page snapshot does not expose; unverifiable pins fail explicitly.
- `manifestPath` is workspace metadata; runtime manifest truth comes from the tested page through Agrune.
- Manifest authoring/repair and recorder-driven gap extraction are not implemented.
- Resolution currently summarizes the resolved selector or unresolved result, not every internal resolver attempt.
- Run files survive an application restart, but Studio does not yet rehydrate run history and artifact indexing from them.
- Human takeover is direct browser control, not action recording or automatic resume.

See [PRODUCT.md](./PRODUCT.md) for the product boundary and design decisions.

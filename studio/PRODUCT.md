# Agrune Studio — product direction

## Product sentence

Agrune Studio is a local semantic QA workbench where developers author strict `agrune.scenario/v1` flows, run them through Agrune in a real headed Chromium window, and inspect the manifest perception, target resolution, timeline, and evidence behind every step.

Its core loop is:

```text
Author → Run → Observe → Diagnose → Edit the executed draft → Replay
```

## Responsibility split

- **The real browser is the execution surface.** The tested page, target highlights, and direct human input stay in external headed Chromium.
- **Studio is the semantic workbench.** It owns scenario authoring, run controls, progress, manifest-oriented inspection, diagnostics, and artifact references.
- **Agrune owns application meaning.** Manifest target discovery, target resolution, and semantic browser actions remain in Agrune core.
- **Playwright owns browser mechanics.** Navigation, DOM interaction, tracing, screenshots, console, and network signals come from one Studio-owned session.

Studio does not embed a webview, stream a JPEG preview, or maintain a second representation of the tested page.

## Principles

1. **One execution session.** Scenario actions, manifest snapshots, target highlights, manual takeover, console, network, screenshots, and traces originate from the same Studio-owned `BrowserSession`.
2. **Actions are semantic; outcomes can be independent.** Interactive actions address manifest refs. Closed assertions can check URL, text, target state, console, and network outcomes independently of the action locator.
3. **Pure data at the boundary.** `agrune.scenario/v1` contains no arbitrary JavaScript. Builder and JSON mode pass through the same strict validator before save or run.
4. **Progress is legible.** A run always exposes the active semantic step, target, elapsed time, result, and first failure.
5. **Human intervention is first-class.** Pause, step, resume, and stop operate at semantic step boundaries. Takeover pauses an active run and foregrounds the real browser.
6. **Local authority stays narrow.** Electron main owns the browser and filesystem; the sandboxed renderer receives only a typed context-bridge API.
7. **Manifest truth stays in Agrune.** Studio orchestrates and visualizes the engine instead of duplicating selector resolution or action logic.
8. **Writes are intentional and bounded.** Workspace-relative paths cannot escape the selected root, invalid configuration fails closed, and an unsaved run draft cannot inherit an unrelated scenario file identity.
9. **Security claims match the implementation.** Text summaries avoid literal fill/type values, while run logs, traces, and screenshots are explicitly treated as potentially sensitive.

## Information architecture

- **Rail:** Scenarios, manifest status/refresh, artifacts/evidence, and workspace selection.
- **Library:** built-in and workspace scenarios, filtering, and current workspace issues or unresolved gaps.
- **Workbench:** selected scenario, ordered semantic steps, and the live agent timeline.
- **Command dock:** Run, Pause/Resume, Step, Stop, Open browser, and Take over.
- **Inspector:** Perception, Resolution, and Evidence.
- **Editor:** structured Builder and canonical JSON views of the same validated document.
- **External Chromium:** the real page, target highlights, and direct human input.

## Implemented V1 boundary

The current vertical slice includes:

- a packaged Electron application with bundled Playwright Chromium;
- one Studio-owned headed Agrune `BrowserSession`;
- a real external browser with no screen mirror or webview;
- a workspace picker and versioned `.agrune/workspace.json` configuration;
- safe, atomic workspace scenario persistence;
- strict `agrune.scenario/v1` validation and deterministic serialization;
- read-only built-in starter scenarios and editable workspace scenarios;
- structured Builder and raw JSON editing;
- manifest-ref action execution and closed declarative assertions;
- run, pause, resume, semantic single-step, and stop;
- target focus and highlight in the real browser;
- direct human takeover by pausing and foregrounding Chromium;
- manifest perception, resolution summaries, and a live activity timeline;
- live console and network diagnostics;
- private, atomic per-run logs plus Playwright trace capture and failure screenshots for configured workspaces;
- first-failure stop with all remaining steps marked skipped;
- exact executed-draft retention so diagnosis and repair never silently revert to the persisted document.

## Explicit non-goals for this slice

V1 captures useful execution evidence, but it does not yet provide:

- browser-interaction recording or recorded-action-to-manifest-ref mapping;
- manifest target creation, editing, selector-ladder repair, or source-file writes;
- a full resolver-rung telemetry viewer;
- a connected secret vault for `secretRef` execution;
- Studio-side run-history rehydration or an artifact catalog across restarts (per-run files remain on disk);
- an embedded Playwright Trace Viewer;
- shared daemon/session attachment with other Agrune clients;
- CI adapters or Playwright Test reporting UI;
- signed scenario packs or distribution workflows.

## Success criterion

A developer should be able to express a small, reviewable QA flow in Agrune language, watch it operate the real application, understand the first failure without reading raw DOM or selector code, repair the exact draft that failed, and replay it with confidence that Studio did not mutate an unrelated file or run against stale workspace state.

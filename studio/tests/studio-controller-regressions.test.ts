import { access, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Scenario } from '../src/scenario';
import { StudioController, resolveDefaultWorkspaceRoot } from '../src/main/studio-controller';
import { createWorkspaceConfig, writeWorkspaceConfig } from '../src/workspace';

const browserHarness = vi.hoisted(() => ({
  instances: [] as Array<Record<string, unknown>>,
  stepBarrier: null as Promise<void> | null,
  traceStopBarrier: null as Promise<void> | null,
  highlightBarrier: null as Promise<void> | null,
  showBrowserError: null as Error | null,
  highlightError: null as Error | null,
}));

vi.mock('agrune', () => {
  class FakeBrowserSession {
    currentUrl = '';
    pages = 0;
    closeAllCount = 0;
    opened: string[] = [];
    events: string[] = [];
    navigationIndex = 0;
    requestIndex = 0;
    consoleLog: Array<{ level: string; text: string; timestamp: number; navigationIndex: number }> = [];
    networkLog: Array<{
      index: number;
      method: string;
      url: string;
      status: number;
      timestamp: number;
      navigationIndex: number;
    }> = [];
    browserContext = { tracing: { stop: async () => undefined } };

    constructor(_headless: boolean) {
      browserHarness.instances.push(this as unknown as Record<string, unknown>);
    }

    get tabCount(): number {
      return this.pages;
    }

    async start(): Promise<void> {}
    async stop(): Promise<void> {}

    async open(url: string): Promise<unknown> {
      this.events.push('open');
      this.pages = 1;
      this.currentUrl = new URL(url).toString();
      this.opened.push(this.currentUrl);
      this.recordNavigationSignals();
      return {};
    }

    async navigate(url: string): Promise<unknown> {
      this.events.push('navigate');
      this.pages = 1;
      this.currentUrl = new URL(url).toString();
      this.recordNavigationSignals();
      return {};
    }

    recordNavigationSignals(): void {
      this.navigationIndex += 1;
      const timestamp = Date.now();
      this.consoleLog.push({
        level: 'info',
        text: `console:${this.currentUrl}`,
        timestamp,
        navigationIndex: this.navigationIndex,
      });
      this.requestIndex += 1;
      this.networkLog.push({
        index: this.requestIndex,
        method: 'GET',
        url: this.currentUrl,
        status: 200,
        timestamp,
        navigationIndex: this.navigationIndex,
      });
    }

    async closeAll(): Promise<void> {
      this.closeAllCount += 1;
      this.pages = 0;
      this.currentUrl = '';
    }

    page(): {
      bringToFront: () => Promise<void>;
      waitForTimeout: () => Promise<void>;
      title: () => Promise<string>;
      url: () => string;
    } {
      return {
        bringToFront: async () => {
          if (browserHarness.showBrowserError) throw browserHarness.showBrowserError;
        },
        waitForTimeout: async () => undefined,
        title: async () => `Title for ${this.currentUrl}`,
        url: () => this.currentUrl,
      };
    }

    async listTabs(): Promise<Array<{ tabId: number; index: number; url: string; title: string; active: boolean }>> {
      return this.pages
        ? [{ tabId: 1, index: 0, url: this.currentUrl, title: `Title for ${this.currentUrl}`, active: true }]
        : [];
    }

    async snapshot(): Promise<Record<string, unknown>> {
      const prefix = this.currentUrl.includes('second.example') ? 'second' : 'first';
      const targetId = `${prefix}_target`;
      return {
        schemaVersion: 3,
        version: 1,
        capturedAt: Date.now(),
        url: this.currentUrl,
        title: `Title for ${this.currentUrl}`,
        groups: [{ groupId: `${prefix}_group`, targetIds: [targetId] }],
        targets: [{
          targetId,
          groupId: `${prefix}_group`,
          name: targetId,
          description: `${prefix} workspace target`,
          actionKinds: ['click'],
          selector: { testId: targetId },
          visible: true,
          inViewport: true,
          enabled: true,
          covered: false,
          actionableNow: true,
          reason: 'ready',
          overlay: false,
          sensitive: false,
          sourceFile: 'manifest.json',
          sourceLine: 1,
          sourceColumn: 1,
          domResolved: true,
        }],
      };
    }

    async highlight(_tabId: number | undefined, ref: string): Promise<void> {
      await browserHarness.highlightBarrier;
      if (browserHarness.highlightError) throw browserHarness.highlightError;
      const snapshot = await this.snapshot() as { targets: Array<{ targetId: string }> };
      if (!snapshot.targets.some((target) => target.targetId === ref)) throw new Error(`Unknown target: ${ref}`);
    }

    async waitForTime(_tabId: number | undefined, _ms: number): Promise<void> {
      this.events.push('step:wait');
      await browserHarness.stepBarrier;
    }
    async read(): Promise<string> { return ''; }
    async click(): Promise<unknown> { return {}; }
    async fill(): Promise<unknown> { return {}; }
    async type(): Promise<void> {}
    async press(): Promise<void> {}
    async select(): Promise<unknown> { return {}; }
    async check(): Promise<void> {}
    async uncheck(): Promise<void> {}
    async waitForTarget(): Promise<void> {}

    consoleMessages(): Array<{ level: string; text: string; timestamp: number; navigationIndex: number }> {
      return this.pages
        ? this.consoleLog.filter((entry) => entry.navigationIndex === this.navigationIndex)
        : [];
    }

    networkRequests(): Array<{
      index: number;
      method: string;
      url: string;
      status: number;
      timestamp: number;
      navigationIndex: number;
    }> {
      return this.pages
        ? this.networkLog.filter((entry) => entry.navigationIndex === this.navigationIndex)
        : [];
    }

    async tracingStart(): Promise<void> { this.events.push('trace:start'); }
    async tracingStop(tracePath: string): Promise<string> {
      this.events.push('trace:stop');
      await browserHarness.traceStopBarrier;
      await mkdir(path.dirname(tracePath), { recursive: true });
      await writeFile(tracePath, 'fake trace', 'utf8');
      return tracePath;
    }
    async screenshot(_tabId: number | undefined, screenshotPath: string): Promise<string> {
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, 'fake screenshot', 'utf8');
      return screenshotPath;
    }
  }

  return { BrowserSession: FakeBrowserSession };
});

const temporaryRoots: string[] = [];

async function temporaryRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `agrune-studio-${label}-`));
  temporaryRoots.push(root);
  return root;
}

function scenario(name: string, ref = 'missing_target'): Scenario {
  return {
    schema: 'agrune.scenario/v1',
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    manifest: { schemaVersion: 3 },
    steps: [{ id: 'check-target', assert: 'targetVisible', ref }],
  };
}

function waitScenario(name: string, ms = 100): Scenario {
  return {
    schema: 'agrune.scenario/v1',
    id: name.toLowerCase().replace(/\s+/g, '-'),
    name,
    manifest: { schemaVersion: 3 },
    steps: [{ id: 'wait', do: 'wait', ms }],
  };
}

afterEach(async () => {
  browserHarness.instances.splice(0);
  browserHarness.stepBarrier = null;
  browserHarness.traceStopBarrier = null;
  browserHarness.highlightBarrier = null;
  browserHarness.showBrowserError = null;
  browserHarness.highlightError = null;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Studio controller regressions', () => {
  it('keeps a missing app-owned onboarding placeholder quiet without creating it', async () => {
    const userDataRoot = await temporaryRoot('user-data');
    const onboardingRoot = path.join(userDataRoot, 'sample-workspace');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: onboardingRoot });

    const initial = await controller.initialize();
    expect(initial.workspace.path).toBe(onboardingRoot);
    expect(initial.workspace.configured).toBe(false);
    expect(initial.workspace.issues).toEqual([]);
    expect(initial.scenarios.length).toBeGreaterThan(0);
    await expect(access(onboardingRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    const explicitEmptyRoot = await temporaryRoot('explicit-empty');
    const opened = await controller.openWorkspace(explicitEmptyRoot);
    expect(opened.workspace.path).toBe(explicitEmptyRoot);
    expect(opened.workspace.configured).toBe(false);
    expect(opened.workspace.issues).toEqual([]);
    await controller.shutdown();
  });

  it('keeps an explicit source key but never inherits the selected row for a new run or step draft', async () => {
    const root = await temporaryRoot('run-source');

    const existingController = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const existing = existingController.runScenario({
      scenario: scenario('Edited built in'),
      scenarioKey: 'built-in:manifest-health',
    });
    expect(existing.run.scenarioKey).toBe('built-in:manifest-health');
    await vi.waitFor(() => expect(existingController.getState().run.finishedAt).toEqual(expect.any(Number)));
    await existingController.shutdown();

    const newController = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const draft = newController.runScenario({ scenario: scenario('Brand new draft') });
    expect(draft.selectedScenarioKey).toBe('built-in:manifest-health');
    expect(draft.run.scenarioKey).toBeUndefined();
    expect(draft.run.document?.name).toBe('Brand new draft');
    await vi.waitFor(() => expect(newController.getState().run.finishedAt).toEqual(expect.any(Number)));
    await newController.shutdown();

    const stepController = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const stepped = stepController.stepRun({ scenario: scenario('Brand new step draft') });
    expect(stepped.run.scenarioKey).toBeUndefined();
    stepController.stopRun();
    await vi.waitFor(() => expect(stepController.getState().run.finishedAt).toEqual(expect.any(Number)));
    await stepController.shutdown();
  });

  it('blocks scenario selection changes while a run is active', async () => {
    const root = await temporaryRoot('selection-guard');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const initial = controller.getState();
    const otherScenarioKey = initial.scenarios.find((item) => item.key !== initial.selectedScenarioKey)!.key;

    controller.stepRun({ scenario: waitScenario('Selection guard') });
    const blocked = controller.selectScenario(otherScenarioKey);

    expect(blocked.selectedScenarioKey).toBe(initial.selectedScenarioKey);
    expect(blocked.run.document?.name).toBe('Selection guard');
    expect(blocked.activity[0]).toMatchObject({
      tone: 'warning',
      title: 'Scenario selection blocked',
    });
    expect(blocked.activity[0]?.detail).toContain('active run');

    controller.stopRun();
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('stopped'));
    await controller.shutdown();
  });

  it('keeps completed run evidence when the selected scenario row is clicked again', async () => {
    const root = await temporaryRoot('same-selection');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const selectedKey = controller.getState().selectedScenarioKey!;

    controller.runScenario({ scenario: waitScenario('Same selection'), scenarioKey: selectedKey });
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('passed'));
    await vi.waitFor(() => expect(controller.getState().run.finishedAt).toEqual(expect.any(Number)));
    const before = controller.getState();

    const after = controller.selectScenario(selectedKey);
    expect(after.run).toEqual(before.run);
    expect(after.evidence).toEqual(before.evidence);
    expect(after.activity).toEqual(before.activity);
    await controller.shutdown();
  });

  it('does not preload a Step permit while the current semantic step is running', async () => {
    const root = await temporaryRoot('step-no-preload');
    let releaseStep!: () => void;
    browserHarness.stepBarrier = new Promise<void>((resolve) => { releaseStep = resolve; });
    const threeSteps: Scenario = {
      schema: 'agrune.scenario/v1',
      id: 'three-step-coalescing-check',
      name: 'Three step coalescing check',
      manifest: { schemaVersion: 3 },
      steps: [
        { id: 'wait-1', do: 'wait', ms: 10 },
        { id: 'wait-2', do: 'wait', ms: 10 },
        { id: 'wait-3', do: 'wait', ms: 10 },
      ],
    };

    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    controller.stepRun({ scenario: threeSteps });
    expect(controller.resumeRun().run.status).toBe('paused');
    let session!: { events: string[] };
    await vi.waitFor(() => {
      session = browserHarness.instances.at(-1) as { events: string[] };
      expect(session.events.filter((event) => event === 'step:wait')).toHaveLength(1);
    });

    // Calls made while the current step is running are ignored. They must not
    // schedule a future step that starts after the current barrier settles.
    controller.stepRun({ scenario: threeSteps });
    controller.stepRun({ scenario: threeSteps });
    expect(controller.resumeRun().run.status).toBe('paused');
    releaseStep();

    await vi.waitFor(() => {
      expect(controller.getState().run.steps[0]?.status).toBe('passed');
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const paused = controller.getState();
    expect(session.events.filter((event) => event === 'step:wait')).toHaveLength(1);
    expect(paused.run.status).toBe('paused');
    expect(paused.run.currentStepIndex).toBe(0);
    expect(paused.run.steps.map((step) => step.status)).toEqual(['passed', 'queued', 'queued']);

    // A fresh request made at the settled boundary advances exactly one step.
    controller.stepRun({ scenario: threeSteps });
    await vi.waitFor(() => {
      expect(session.events.filter((event) => event === 'step:wait')).toHaveLength(2);
      expect(controller.getState().run.steps[1]?.status).toBe('passed');
    });
    expect(controller.getState().run.steps.map((step) => step.status)).toEqual(['passed', 'passed', 'queued']);

    controller.stopRun();
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('stopped'));
    await controller.shutdown();
  });

  it('publishes a running step before target focus work settles', async () => {
    const root = await temporaryRoot('step-running-publish');
    let releaseHighlight!: () => void;
    browserHarness.highlightBarrier = new Promise<void>((resolve) => { releaseHighlight = resolve; });
    const published: Array<ReturnType<StudioController['getState']>> = [];
    const controller = new StudioController((state) => published.push(state), { defaultWorkspaceRoot: root });

    controller.stepRun({ scenario: scenario('Running publish', 'first_target') });
    await vi.waitFor(() => {
      expect(published.some((state) => state.run.steps[0]?.status === 'running')).toBe(true);
    });
    expect(controller.getState().run.steps[0]?.status).toBe('running');

    releaseHighlight();
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('passed'));
    await controller.shutdown();
  });

  it('rejects showBrowser when Chromium cannot be brought forward', async () => {
    const root = await temporaryRoot('show-browser-error');
    const published: Array<ReturnType<StudioController['getState']>> = [];
    const controller = new StudioController((state) => published.push(state), { defaultWorkspaceRoot: root });
    browserHarness.showBrowserError = new Error('Window activation denied');

    await expect(controller.showBrowser()).rejects.toThrow('Window activation denied');
    expect(controller.getState().activity[0]).toMatchObject({
      tone: 'error',
      title: 'Browser could not be shown',
      detail: 'Window activation denied',
    });
    expect(published.at(-1)?.activity[0]?.title).toBe('Browser could not be shown');
    await controller.shutdown();
  });

  it('reports a target as highlighted only when manifest resolution succeeds', async () => {
    const root = await temporaryRoot('highlight-result');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });

    const missing = await controller.highlightTarget('missing_target');
    expect(missing.evidence.resolution).toMatchObject({
      ref: 'missing_target',
      status: 'unresolved',
    });
    expect(missing.activity.some((entry) => entry.title === 'Target highlighted' && entry.targetRef === 'missing_target')).toBe(false);
    expect(missing.activity.some((entry) => entry.title === 'Manifest ref unresolved' && entry.targetRef === 'missing_target')).toBe(true);

    const resolved = await controller.highlightTarget('first_target');
    expect(resolved.evidence.resolution).toMatchObject({
      ref: 'first_target',
      status: 'resolved',
    });
    expect(resolved.activity.some((entry) => entry.title === 'Target highlighted' && entry.targetRef === 'first_target')).toBe(true);
    await controller.shutdown();
  });

  it('does not report visual highlight success when resolution succeeds but the overlay fails', async () => {
    const root = await temporaryRoot('highlight-overlay-failure');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    browserHarness.highlightError = new Error('Overlay injection was blocked');

    const state = await controller.highlightTarget('first_target');
    expect(state.evidence.resolution).toMatchObject({
      ref: 'first_target',
      status: 'resolved',
      message: expect.stringContaining('Overlay injection was blocked'),
    });
    expect(state.activity.some((entry) => entry.title === 'Target highlighted')).toBe(false);
    expect(state.activity.some((entry) => entry.title === 'Target could not be highlighted')).toBe(true);
    await controller.shutdown();
  });

  it('blocks secretRef scenarios before any browser action for both Run and Step mode', async () => {
    const root = await temporaryRoot('secret-preflight');
    const secretScenario: Scenario = {
      schema: 'agrune.scenario/v1',
      id: 'secret-preflight',
      name: 'Secret preflight',
      manifest: { schemaVersion: 3 },
      steps: [{ id: 'secret', do: 'fill', ref: 'login.password', secretRef: 'qa.password' }],
    };

    const runController = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const runState = runController.runScenario({ scenario: secretScenario });
    expect(runState.run).toMatchObject({ status: 'failed', currentStepIndex: -1 });
    expect(runState.run.id).toBeUndefined();
    expect(runState.run.error).toContain('blocked before any browser action ran');
    expect(browserHarness.instances).toHaveLength(0);
    await runController.shutdown();

    const stepController = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const stepState = stepController.stepRun({ scenario: secretScenario });
    expect(stepState.run).toMatchObject({ status: 'failed', currentStepIndex: -1 });
    expect(stepState.run.id).toBeUndefined();
    expect(browserHarness.instances).toHaveLength(0);
    await stepController.shutdown();
  });

  it('keeps a stopped run in stopping state until evidence finalization completes', async () => {
    const root = await temporaryRoot('stop-finalization');
    await writeWorkspaceConfig(createWorkspaceConfig({ root, baseUrl: 'https://first.example' }));
    let releaseStep!: () => void;
    let releaseTrace!: () => void;
    browserHarness.stepBarrier = new Promise<void>((resolve) => { releaseStep = resolve; });
    browserHarness.traceStopBarrier = new Promise<void>((resolve) => { releaseTrace = resolve; });

    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    await controller.initialize();
    const started = controller.runScenario({ scenario: waitScenario('Controlled stop') });
    const runId = started.run.id;
    const session = browserHarness.instances.at(-1) as { events: string[] };
    await vi.waitFor(() => expect(session.events).toContain('step:wait'));

    const stopping = controller.stopRun();
    expect(stopping.run.status).toBe('stopping');
    expect(stopping.run.finishedAt).toBeUndefined();
    expect(stopping.activity[0]?.title).toBe('Stopping run');
    expect(controller.runScenario({ scenario: waitScenario('Must be ignored') }).run.id).toBe(runId);

    releaseStep();
    await vi.waitFor(() => expect(session.events).toContain('trace:stop'));
    expect(controller.getState().run.status).toBe('stopping');
    expect(controller.getState().run.finishedAt).toBeUndefined();

    releaseTrace();
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('stopped'));
    const stopped = controller.getState();
    expect(stopped.run.finishedAt).toEqual(expect.any(Number));
    expect(stopped.run.steps[0]?.status).toBe('passed');
    expect(stopped.evidence.artifacts.some((artifact) => artifact.kind === 'run-log')).toBe(true);
    await controller.shutdown();
  });

  it('publishes finalizing after the last semantic step and passed only after artifacts settle', async () => {
    const root = await temporaryRoot('passed-finalization');
    await writeWorkspaceConfig(createWorkspaceConfig({ root, baseUrl: 'https://first.example' }));
    let releaseTrace!: () => void;
    browserHarness.traceStopBarrier = new Promise<void>((resolve) => { releaseTrace = resolve; });
    const published: Array<ReturnType<StudioController['getState']>> = [];
    const controller = new StudioController((state) => published.push(state), { defaultWorkspaceRoot: root });
    await controller.initialize();

    const started = controller.runScenario({ scenario: waitScenario('Controlled pass') });
    const runId = started.run.id;
    const session = browserHarness.instances.at(-1) as { events: string[] };
    await vi.waitFor(() => expect(session.events).toContain('trace:stop'));

    const finalizing = controller.getState();
    expect(finalizing.run.status).toBe('finalizing');
    expect(finalizing.run.steps.map((step) => step.status)).toEqual(['passed']);
    expect(finalizing.run.finishedAt).toBeUndefined();
    expect(finalizing.activity[0]).toMatchObject({
      tone: 'info',
      title: 'Finalizing run evidence',
    });
    expect(controller.runScenario({ scenario: waitScenario('Must be ignored') }).run.id).toBe(runId);
    expect(published.some((state) => state.run.status === 'passed')).toBe(false);

    releaseTrace();
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('passed'));
    const passed = controller.getState();
    expect(passed.run.finishedAt).toEqual(expect.any(Number));
    expect(passed.activity[0]?.title).toBe('Run log saved');
    expect(passed.activity.some((entry) => entry.title === 'Scenario passed')).toBe(true);
    expect(passed.evidence.artifacts.some((artifact) => artifact.kind === 'run-log')).toBe(true);

    const finalizingIndex = published.findIndex((state) => state.run.status === 'finalizing');
    const passedIndex = published.findIndex((state) => state.run.status === 'passed');
    expect(finalizingIndex).toBeGreaterThanOrEqual(0);
    expect(passedIndex).toBeGreaterThan(finalizingIndex);
    await controller.shutdown();
  });

  it('rebinds an exact ephemeral run to its saved row but never binds a changed document', async () => {
    const exactRoot = await temporaryRoot('exact-save');
    const exactController = new StudioController(() => undefined, { defaultWorkspaceRoot: exactRoot });
    const exactDraft = scenario('Ephemeral exact draft');
    exactController.runScenario({ scenario: exactDraft });
    await vi.waitFor(() => expect(exactController.getState().run.finishedAt).toEqual(expect.any(Number)));

    const exactSaved = await exactController.saveScenario({
      scenario: exactDraft,
      fileName: 'ephemeral-exact.agrune.json',
    });
    expect(exactSaved.run.scenarioKey).toBe('workspace:ephemeral-exact.agrune.json');
    expect(exactSaved.scenarios.filter((item) => item.document.name === exactDraft.name)).toHaveLength(1);
    expect(exactSaved.selectedScenarioKey).toBe('workspace:ephemeral-exact.agrune.json');
    await exactController.shutdown();

    const changedRoot = await temporaryRoot('changed-save');
    const changedController = new StudioController(() => undefined, { defaultWorkspaceRoot: changedRoot });
    const executedDraft = scenario('Ephemeral changed draft');
    changedController.runScenario({ scenario: executedDraft });
    await vi.waitFor(() => expect(changedController.getState().run.finishedAt).toEqual(expect.any(Number)));

    const editedAfterRun: Scenario = { ...executedDraft, description: 'Edited after the recorded run.' };
    const changedSaved = await changedController.saveScenario({
      scenario: editedAfterRun,
      fileName: 'ephemeral-changed.agrune.json',
    });
    expect(changedSaved.run.scenarioKey).toBeUndefined();
    expect(changedSaved.run.document).toEqual(executedDraft);
    expect(changedSaved.scenarios).toContainEqual(expect.objectContaining({
      key: 'workspace:ephemeral-changed.agrune.json',
      document: expect.objectContaining({ description: 'Edited after the recorded run.' }),
    }));
    await changedController.shutdown();
  });

  it('shows a newly saved workspace revision instead of a stale completed-run document', async () => {
    const root = await temporaryRoot('save-after-run');
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    const original = waitScenario('Saved revision');
    const firstSave = await controller.saveScenario({ scenario: original, fileName: 'saved-revision.agrune.json' });
    const scenarioKey = firstSave.selectedScenarioKey!;

    controller.runScenario({ scenario: original, scenarioKey });
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('passed'));

    const edited: Scenario = { ...original, description: 'Visible immediately after save.' };
    const afterSave = await controller.saveScenario({ scenario: edited, fileName: 'saved-revision.agrune.json' });
    expect(afterSave.run).toEqual({ status: 'idle', currentStepIndex: -1, steps: [] });
    expect(afterSave.scenarios.find((item) => item.key === scenarioKey)?.document.description).toBe('Visible immediately after save.');
    await controller.shutdown();
  });

  it('uses an app-owned onboarding path when packaged and retains demo discovery in development', () => {
    const existing = new Set(['/Applications/Agrune Studio.app/demo', '/Users/test/dev/agrune/demo']);
    const packaged = resolveDefaultWorkspaceRoot({
      isPackaged: true,
      appPath: '/Applications/Agrune Studio.app/Contents/Resources/app.asar',
      homePath: '/Users/test',
      userDataPath: '/Users/test/Library/Application Support/Agrune Studio',
      pathExists: (candidate) => existing.has(candidate),
    });
    expect(packaged).toBe('/Users/test/Library/Application Support/Agrune Studio/sample-workspace');
    expect(packaged).not.toBe('/Users/test');

    const development = resolveDefaultWorkspaceRoot({
      isPackaged: false,
      appPath: '/Users/test/dev/agrune/agrune-studio',
      homePath: '/Users/test',
      userDataPath: '/Users/test/Library/Application Support/Agrune Studio',
      pathExists: (candidate) => candidate === '/Users/test/dev/agrune/demo',
    });
    expect(development).toBe('/Users/test/dev/agrune/demo');
  });

  it('clears workspace-bound run evidence and rebinds the browser to the new base URL', async () => {
    const firstRoot = await temporaryRoot('first-workspace');
    const secondRoot = await temporaryRoot('second-workspace');
    await writeWorkspaceConfig(createWorkspaceConfig({ root: firstRoot, baseUrl: 'https://first.example' }));
    await writeWorkspaceConfig(createWorkspaceConfig({ root: secondRoot, baseUrl: 'https://second.example' }));

    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: firstRoot });
    await controller.initialize();
    await controller.showBrowser();
    controller.runScenario({
      scenario: { ...scenario('Failure with evidence'), url: 'https://first.example/failure' },
      scenarioKey: 'built-in:manifest-health',
    });
    await vi.waitFor(() => expect(controller.getState().run.status).toBe('failed'));
    await vi.waitFor(() => expect(controller.getState().run.finishedAt).toEqual(expect.any(Number)));

    const before = controller.getState();
    expect(before.run.document?.name).toBe('Failure with evidence');
    expect(before.evidence.resolution?.status).toBe('unresolved');
    expect(before.browser.targets.map((target) => target.targetId)).toContain('first_target');
    expect(before.diagnostics.console[0]?.text).toContain('first.example');

    let after = controller.getState();
    await vi.waitFor(async () => {
      const candidate = await controller.openWorkspace(secondRoot);
      expect(candidate.workspace.path).toBe(secondRoot);
      after = candidate;
    });
    expect(after.run).toEqual({ status: 'idle', currentStepIndex: -1, steps: [] });
    expect(after.evidence).toEqual({ artifacts: [] });
    expect(after.browser.url).toBe('https://second.example/');
    expect(after.browser.targets.map((target) => target.targetId)).toEqual(['second_target']);
    expect(after.diagnostics.console.map((entry) => entry.text)).toEqual(['console:https://second.example/']);
    expect(after.diagnostics.network.map((entry) => entry.url)).toEqual(['https://second.example/']);
    expect(after.activity.map((entry) => entry.title)).toEqual(expect.arrayContaining([
      'Workspace context initialized',
      'Workspace opened',
    ]));
    expect(after.activity.every((entry) => !`${entry.title} ${entry.detail ?? ''}`.includes(firstRoot))).toBe(true);
    expect(after.activity.every((entry) => !`${entry.title} ${entry.detail ?? ''}`.includes('first.example'))).toBe(true);
    const session = browserHarness.instances.at(-1) as { closeAllCount: number; opened: string[] };
    expect(session.closeAllCount).toBe(1);
    expect(session.opened.at(-1)).toBe('https://second.example/');
    await controller.shutdown();
  });

  it('scopes artifacts and diagnostics to the newest run', async () => {
    const root = await temporaryRoot('run-evidence-scope');
    await writeWorkspaceConfig(createWorkspaceConfig({ root, baseUrl: 'https://first.example' }));
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    await controller.initialize();

    controller.runScenario({
      scenario: { ...scenario('First failed run'), url: 'https://first.example/first-run' },
    });
    await vi.waitFor(() => {
      expect(controller.getState().run.status).toBe('failed');
      expect(controller.getState().evidence.artifacts.some((artifact) => artifact.kind === 'run-log')).toBe(true);
    });
    const first = controller.getState();
    const firstRunId = first.run.id!;
    expect(first.evidence.artifacts.length).toBeGreaterThan(0);
    expect(first.diagnostics.console[0]?.text).toContain('first-run');
    expect(first.diagnostics.network[0]?.url).toContain('first-run');

    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondStarted = controller.runScenario({ scenario: waitScenario('Second clean run') });
    const secondRunId = secondStarted.run.id!;
    expect(secondRunId).not.toBe(firstRunId);
    expect(secondStarted.evidence).toEqual({ artifacts: [] });
    expect(secondStarted.diagnostics).toEqual({ console: [], network: [] });

    await vi.waitFor(() => {
      expect(controller.getState().run.status).toBe('passed');
      expect(controller.getState().evidence.artifacts.some((artifact) => artifact.kind === 'run-log')).toBe(true);
    });
    const second = controller.getState();
    expect(second.diagnostics).toEqual({ console: [], network: [] });
    expect(second.evidence.artifacts.length).toBeGreaterThan(0);
    expect(second.evidence.artifacts.every((artifact) => artifact.id.startsWith(`${secondRunId}-`))).toBe(true);
    expect(second.evidence.artifacts.some((artifact) => artifact.id.startsWith(`${firstRunId}-`))).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 5));
    const afterRunNavigation = await controller.navigate('https://first.example/after-run');
    expect(afterRunNavigation.diagnostics).toEqual({ console: [], network: [] });
    await controller.shutdown();
  });

  it('persists a private run log with diagnostics and starts tracing before run navigation', async () => {
    const root = await temporaryRoot('persistent-run-log');
    await writeWorkspaceConfig(createWorkspaceConfig({ root, baseUrl: 'https://first.example' }));
    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: root });
    await controller.initialize();

    const session = browserHarness.instances.at(-1) as { events: string[] };
    session.events.splice(0);
    controller.runScenario({
      scenario: {
        ...scenario('Persistent failure'),
        url: 'https://first.example/failure',
      },
    });

    await vi.waitFor(() => {
      expect(controller.getState().evidence.artifacts.some((artifact) => artifact.kind === 'run-log')).toBe(true);
    });
    const state = controller.getState();
    const runLog = state.evidence.artifacts.find((artifact) => artifact.kind === 'run-log');
    expect(runLog?.path).toBe(path.join(root, `.agrune/artifacts/runs/${state.run.id}/run.json`));

    const document = JSON.parse(await readFile(runLog!.path, 'utf8')) as {
      schema: string;
      run: { id: string; status: string; scenario: { name: string }; error?: string };
      steps: Array<{ status: string; error?: string }>;
      diagnostics: {
        console: Array<{ text: string }>;
        network: Array<{ url: string }>;
      };
      activity: Array<{ title: string }>;
      artifacts: Array<{ kind: string; file: string }>;
    };
    expect(document.schema).toBe('agrune.run-log/v1');
    expect(document.run).toMatchObject({
      id: state.run.id,
      status: 'failed',
      scenario: { name: 'Persistent failure' },
    });
    expect(document.run.error).toContain('missing_target');
    expect(document.steps[0]).toMatchObject({ status: 'failed' });
    expect(document.diagnostics.console[0]?.text).toContain('first.example/failure');
    expect(document.diagnostics.network[0]?.url).toBe('https://first.example/failure');
    expect(document.activity.map((entry) => entry.title)).toContain('Scenario started');
    expect(document.activity[0]?.title).toBe('Scenario started');
    expect(document.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'screenshot', file: 'failure.png' }),
      expect.objectContaining({ kind: 'trace', file: 'trace.zip' }),
    ]));
    if (process.platform !== 'win32') {
      expect((await stat(runLog!.path)).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(path.dirname(runLog!.path), 'failure.png'))).mode & 0o777).toBe(0o600);
      expect((await stat(path.join(path.dirname(runLog!.path), 'trace.zip'))).mode & 0o777).toBe(0o600);
    }
    expect(session.events.indexOf('trace:start')).toBeGreaterThanOrEqual(0);
    expect(session.events.indexOf('trace:start')).toBeLessThan(session.events.indexOf('open'));
    expect(session.events.indexOf('trace:stop')).toBeGreaterThan(session.events.indexOf('open'));
    await controller.shutdown();
  });

  it('fails closed for an invalid workspace config instead of saving through fallback defaults', async () => {
    const defaultRoot = await temporaryRoot('default-workspace');
    const invalidRoot = await temporaryRoot('invalid-workspace');
    await mkdir(path.join(invalidRoot, '.agrune'), { recursive: true });
    await writeFile(path.join(invalidRoot, '.agrune/workspace.json'), '{ invalid json', 'utf8');

    const controller = new StudioController(() => undefined, { defaultWorkspaceRoot: defaultRoot });
    const opened = await controller.openWorkspace(invalidRoot);
    expect(opened.workspace.configured).toBe(false);
    expect(opened.workspace.issues.length).toBeGreaterThan(0);

    await expect(controller.saveScenario({ scenario: scenario('Must not save') })).rejects.toMatchObject({
      code: 'INVALID_WORKSPACE_CONFIG',
    });
    await expect(access(path.join(invalidRoot, '.agrune/scenarios/must-not-save.agrune.json'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await controller.shutdown();
  });
});

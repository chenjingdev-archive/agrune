import path from 'node:path';
import { chmod } from 'node:fs/promises';
import type { BrowserSession, PageSnapshot, PageTarget } from 'agrune';
import {
  collectScenarioDependencies,
  describeScenarioStep,
  executeScenarioStep,
  getStepTargetRef,
  isActionStep,
  isAssertionStep,
  parseScenario,
  serializeScenario,
  type Scenario,
  type ScenarioRuntime,
  type ScenarioStep,
} from '../scenario';
import type {
  ActivityEntry,
  ArtifactView,
  BrowserHistoryAction,
  ManifestTargetView,
  RunStatus,
  RunScenarioRequest,
  SaveScenarioRequest,
  StepRunState,
  StudioScenarioItem,
  StudioState,
  WorkspaceIssue,
} from '../shared/contracts';
import { DEFAULT_SCENARIOS, DEMO_URL } from '../shared/default-scenarios';
import { recoverScenarioActionWithPlaywright } from './playwright-recovery';
import { writeRunLog } from './run-log';
import {
  WorkspaceError,
  WorkspaceStore,
  createWorkspaceConfig,
  type ScenarioFileSummary,
} from '../workspace';

type StatePublisher = (state: StudioState) => void;
type TerminalRunStatus = Extract<RunStatus, 'passed' | 'failed' | 'stopped'>;

const SETTLE_MS = 140;
const MAX_ACTIVITY = 160;
const MAX_DIAGNOSTICS = 200;
const MAX_ARTIFACTS = 30;

interface ControllerOptions {
  defaultWorkspaceRoot?: string;
}

export interface DefaultWorkspaceRootOptions {
  isPackaged: boolean;
  requested?: string;
  appPath: string;
  homePath: string;
  userDataPath: string;
  pathExists: (candidate: string) => boolean;
}

export function resolveDefaultWorkspaceRoot(options: DefaultWorkspaceRootOptions): string {
  const requested = options.requested?.trim();
  if (requested && options.pathExists(requested)) return requested;
  if (!options.isPackaged) {
    const candidates = [
      path.resolve(options.appPath, '../demo'),
      path.join(options.homePath, 'dev/agrune/demo'),
    ];
    const demo = candidates.find(options.pathExists);
    if (demo) return demo;
  }
  // Packaged Studio never guesses Documents or $HOME as a writable project.
  // This app-owned location is an onboarding placeholder until the user opens
  // a workspace; it is not created merely by launching Studio.
  return path.join(options.userDataPath, 'sample-workspace');
}

function scenarioKey(source: 'built-in' | 'workspace', identity: string): string {
  return `${source}:${identity}`;
}

function builtInItems(): StudioScenarioItem[] {
  return DEFAULT_SCENARIOS.map((document, index) => ({
    key: scenarioKey('built-in', document.id ?? String(index)),
    source: 'built-in',
    readOnly: true,
    document: structuredClone(document),
  }));
}

function createInitialState(defaultWorkspaceRoot: string): StudioState {
  const scenarios = builtInItems();
  return {
    engine: { status: 'idle', message: 'Browser engine is waiting' },
    workspace: {
      name: path.basename(defaultWorkspaceRoot) || 'Agrune Demo',
      path: defaultWorkspaceRoot,
      baseUrl: DEMO_URL,
      manifestPath: 'manifest.json',
      scenarioDir: '.agrune/scenarios',
      artifactDir: '.agrune/artifacts',
      configured: false,
      issues: [],
    },
    browser: {
      connected: false,
      loading: false,
      headed: true,
      url: DEMO_URL,
      title: '',
      targetCount: 0,
      groupCount: 0,
      targets: [],
      groups: [],
    },
    scenarios,
    selectedScenarioKey: scenarios[0]?.key ?? '',
    run: {
      status: 'idle',
      currentStepIndex: -1,
      steps: [],
    },
    evidence: { artifacts: [] },
    diagnostics: { console: [], network: [] },
    activity: [
      {
        id: 'boot-0',
        timestamp: Date.now(),
        tone: 'neutral',
        kind: 'system',
        title: 'Studio initialized',
        detail: 'Scenarios stay declarative while Agrune and Playwright own browser execution.',
      },
    ],
  };
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2_000 ? message : `${message.slice(0, 1_999)}…`;
}

function unsupportedStudioExecution(scenario: Scenario): Error | undefined {
  const secretRefs = collectScenarioDependencies(scenario).secretRefs;
  if (!secretRefs.length) return undefined;
  return new Error(
    `Secret vault execution is not connected. This scenario requires ${secretRefs.length} secret reference${secretRefs.length === 1 ? '' : 's'} and was blocked before any browser action ran.`,
  );
}

function cloneState(state: StudioState): StudioState {
  return structuredClone(state);
}

function toIssues(error: unknown, fallbackPath = ''): WorkspaceIssue[] {
  if (error instanceof WorkspaceError && Array.isArray(error.details)) {
    const details = error.details as Array<{ path?: unknown; message?: unknown }>;
    const mapped = details
      .filter((item) => typeof item.message === 'string')
      .map((item) => ({
        path: typeof item.path === 'string' ? item.path : fallbackPath,
        message: item.message as string,
      }));
    if (mapped.length > 0) return mapped;
  }
  return [{ path: fallbackPath, message: errorMessage(error) }];
}

function selectorSummary(target: PageTarget): string {
  const selector = target.selector;
  if (selector.testId) return `testId=${JSON.stringify(selector.testId)}`;
  if (selector.role) {
    const level = selector.role.level ? `, level=${JSON.stringify(selector.role.level)}` : '';
    return `role=${JSON.stringify(selector.role.name)}${level}`;
  }
  if (selector.attr) return `attr=${JSON.stringify(selector.attr)}`;
  if (selector.css) return `css=${JSON.stringify(selector.css)}`;
  if (selector.text) return `text=${JSON.stringify(selector.text)}`;
  return 'selector unavailable';
}

function targetView(target: PageTarget): ManifestTargetView {
  return {
    targetId: target.targetId,
    groupId: target.groupId,
    ...(target.groupName ? { groupName: target.groupName } : {}),
    name: target.name,
    description: target.description,
    actionKinds: [...target.actionKinds],
    selector: selectorSummary(target),
    visible: target.visible,
    inViewport: target.inViewport,
    enabled: target.enabled,
    covered: target.covered,
    actionable: target.actionableNow,
    reason: target.reason,
    domResolved: target.domResolved === true,
    overlay: target.overlay,
    sensitive: target.sensitive,
    ...(!target.sensitive && target.textContent ? { textPreview: target.textContent.slice(0, 160) } : {}),
    ...(target.repeatInstance ? { repeat: { ...target.repeatInstance } } : {}),
    source: {
      file: target.sourceFile,
      line: target.sourceLine,
      column: target.sourceColumn,
    },
  };
}

function matchesTargetRef(target: ManifestTargetView, ref: string): boolean {
  if (target.targetId === ref) return true;
  if (!target.repeat) return false;
  const match = /^(.*)\[key=([^\]]+)\]\.([^\.]+)$/.exec(ref);
  if (!match) return false;
  const [, repeatId, key, leaf] = match;
  return target.repeat.repeatId === repeatId && target.repeat.key === key && target.targetId.endsWith(`.${leaf}`);
}

function normalizedScenarioFileName(requested: string | undefined, scenario: Scenario): string {
  const raw = requested?.trim() || scenario.id || scenario.name;
  let safe = raw
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._/-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-./]+|[-./]+$/g, '');
  if (!safe) safe = `scenario-${Date.now()}`;
  if (safe.endsWith('.agrune.json')) return safe;
  if (safe.endsWith('.json')) safe = safe.slice(0, -'.json'.length);
  return `${safe}.agrune.json`;
}

export class StudioController {
  private session: BrowserSession | null = null;
  private workspaceStore: WorkspaceStore;
  private state: StudioState;
  private runLoopActive = false;
  private stopRequested = false;
  private stepPermits = 0;
  private gateResolvers: Array<() => void> = [];
  private activityCounter = 0;
  private runActivityStartId: string | undefined;
  private tracingActive = false;
  private workspaceConfigIssues: WorkspaceIssue[] = [];
  private workspaceConfigUsable = true;

  constructor(
    private readonly publishState: StatePublisher,
    options: ControllerOptions = {},
  ) {
    const defaultWorkspaceRoot = path.resolve(options.defaultWorkspaceRoot ?? path.resolve(process.cwd(), '../demo'));
    this.workspaceStore = new WorkspaceStore(createWorkspaceConfig({ root: defaultWorkspaceRoot, baseUrl: DEMO_URL }));
    this.state = createInitialState(defaultWorkspaceRoot);
  }

  getState(): StudioState {
    return cloneState(this.state);
  }

  async initialize(): Promise<StudioState> {
    await this.loadWorkspace(this.state.workspace.path, false);
    await this.ensureSession().catch(() => undefined);
    return this.getState();
  }

  async shutdown(): Promise<void> {
    this.stopRequested = true;
    this.releaseGate();
    if (this.tracingActive && this.session) {
      await this.session.browserContext.tracing.stop().catch(() => undefined);
      this.tracingActive = false;
    }
    await this.session?.stop().catch(() => undefined);
    this.session = null;
  }

  async openWorkspace(workspacePath: string): Promise<StudioState> {
    if (this.runLoopActive) {
      this.addActivity('warning', 'system', 'A run is active', 'Stop the run before changing workspaces.');
      this.emitState();
      return this.getState();
    }
    await this.loadWorkspace(workspacePath, true);
    return this.getState();
  }

  async navigate(rawUrl: string): Promise<StudioState> {
    const url = this.normalizeUrl(rawUrl);
    this.state.browser.loading = true;
    this.state.browser.url = url;
    this.emitState();
    try {
      const session = await this.ensureSession();
      if (session.tabCount === 0) await session.open(url);
      else await session.navigate(url);
      await session.page().bringToFront();
      this.addActivity('info', 'action', 'Browser navigated', url);
      await this.afterBrowserMutation();
    } catch (error) {
      this.state.browser.loading = false;
      this.addActivity('error', 'error', 'Navigation failed', errorMessage(error));
      await this.refreshSignals();
      this.emitState();
    }
    return this.getState();
  }

  async history(action: BrowserHistoryAction): Promise<StudioState> {
    if (!this.session || this.session.tabCount === 0) return this.getState();
    this.state.browser.loading = true;
    this.emitState();
    try {
      if (action === 'back') await this.session.back();
      else if (action === 'forward') await this.session.forward();
      else await this.session.reload();
      this.addActivity('neutral', 'action', action === 'reload' ? 'Page reloaded' : `History: ${action}`);
      await this.afterBrowserMutation();
    } catch (error) {
      this.state.browser.loading = false;
      this.addActivity('error', 'error', 'Browser command failed', errorMessage(error));
      this.emitState();
    }
    return this.getState();
  }

  selectScenario(key: string): StudioState {
    if (!this.scenarioByKey(key)) return this.getState();
    if (key === this.state.selectedScenarioKey) return this.getState();
    if (this.runLoopActive && key !== this.state.selectedScenarioKey) {
      this.addActivity(
        'warning',
        'system',
        'Scenario selection blocked',
        'Stop or finish the active run before selecting another scenario.',
      );
      this.emitState();
      return this.getState();
    }
    this.state.selectedScenarioKey = key;
    if (!this.runLoopActive) this.resetRun();
    this.emitState();
    return this.getState();
  }

  async saveScenario(request: SaveScenarioRequest): Promise<StudioState> {
    try {
      if (!this.workspaceConfigUsable) {
        throw new WorkspaceError(
          'INVALID_WORKSPACE_CONFIG',
          'Scenario saving is blocked because this workspace has an invalid .agrune/workspace.json.',
        );
      }
      const scenario = parseScenario(request.scenario);
      const fileName = normalizedScenarioFileName(request.fileName, scenario);
      const saved = await this.workspaceStore.scenarios.write(fileName, scenario);
      const savedKey = scenarioKey('workspace', saved.path);
      const replacesCompletedRun = !this.runLoopActive && this.state.run.scenarioKey === savedKey;
      const runMatchesSavedDocument = this.state.run.document !== undefined &&
        serializeScenario(this.state.run.document) === serializeScenario(saved.scenario);
      await this.reloadScenarioLibrary(savedKey);
      if (replacesCompletedRun) this.resetRun();
      else if (runMatchesSavedDocument) this.state.run.scenarioKey = savedKey;
      this.addActivity('success', 'system', 'Scenario saved', saved.path);
    } catch (error) {
      this.addActivity('error', 'error', 'Scenario could not be saved', errorMessage(error));
      this.emitState();
      throw error;
    }
    this.emitState();
    return this.getState();
  }

  runScenario(request: RunScenarioRequest): StudioState {
    if (this.runLoopActive) return this.getState();
    let scenario: Scenario;
    try {
      scenario = parseScenario(request.scenario);
    } catch (error) {
      this.failBeforeRun('Scenario is invalid', error);
      return this.getState();
    }
    const executionError = unsupportedStudioExecution(scenario);
    if (executionError) {
      this.failBeforeRun('Scenario cannot run in Studio yet', executionError);
      return this.getState();
    }
    this.beginRun(scenario, false, this.validScenarioSourceKey(request.scenarioKey));
    return this.getState();
  }

  stepRun(request: RunScenarioRequest): StudioState {
    if (!this.runLoopActive) {
      let scenario: Scenario;
      try {
        scenario = parseScenario(request.scenario);
      } catch (error) {
        this.failBeforeRun('Scenario is invalid', error);
        return this.getState();
      }
      const executionError = unsupportedStudioExecution(scenario);
      if (executionError) {
        this.failBeforeRun('Scenario cannot run in Studio yet', executionError);
        return this.getState();
      }
      this.beginRun(scenario, true, this.validScenarioSourceKey(request.scenarioKey));
      return this.getState();
    }
    const stepExecuting = this.state.run.steps.some((step) => step.status === 'running');
    if (this.state.run.status === 'paused' && !stepExecuting && this.stepPermits === 0) {
      // A Step request is accepted only at a settled semantic-step boundary.
      // Calls made while a step is running, or while an accepted request is
      // waiting to start, must not preload another permit.
      this.stepPermits = 1;
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  pauseRun(): StudioState {
    if (this.state.run.status === 'running') {
      this.state.run.status = 'paused';
      this.addActivity('warning', 'system', 'Run paused', 'Execution will pause before the next semantic step.');
      this.emitState();
    }
    return this.getState();
  }

  resumeRun(): StudioState {
    const stepExecuting = this.state.run.steps.some((step) => step.status === 'running');
    if (this.state.run.status === 'paused' && !stepExecuting && this.stepPermits === 0) {
      this.state.run.status = 'running';
      this.stepPermits = 0;
      this.addActivity('info', 'system', 'Run resumed');
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  stopRun(): StudioState {
    if (
      this.runLoopActive &&
      (this.state.run.status === 'running' || this.state.run.status === 'paused')
    ) {
      this.stopRequested = true;
      this.state.run.status = 'stopping';
      this.addActivity(
        'warning',
        'system',
        'Stopping run',
        'The current browser command and evidence cleanup will finish before another run can start.',
      );
      this.releaseGate();
      this.emitState();
    }
    return this.getState();
  }

  async showBrowser(): Promise<StudioState> {
    try {
      const session = await this.ensureSession();
      if (session.tabCount === 0) await session.open(this.state.workspace.baseUrl);
      await session.page().bringToFront();
      this.addActivity('info', 'system', 'Browser brought to front');
      await this.refreshSignals();
    } catch (error) {
      this.addActivity('error', 'error', 'Browser could not be shown', errorMessage(error));
      this.emitState();
      throw error;
    }
    this.emitState();
    return this.getState();
  }

  async highlightTarget(targetRef: string): Promise<StudioState> {
    if (this.runLoopActive) {
      this.addActivity('warning', 'system', 'Target highlight blocked', 'Stop the active run before inspecting another target.', { targetRef });
      this.emitState();
      return this.getState();
    }
    try {
      const session = await this.ensureSession();
      if (session.tabCount === 0) await session.open(this.state.workspace.baseUrl);
      await this.captureResolution(targetRef, true);
      const resolution = this.state.evidence.resolution;
      if (resolution?.ref === targetRef && resolution.status === 'resolved' && !resolution.message) {
        await session.page().bringToFront();
        this.addActivity('info', 'resolution', 'Target highlighted', targetRef, { targetRef });
      } else if (resolution?.ref === targetRef) {
        this.addActivity('error', 'resolution', 'Target could not be highlighted', resolution.message ?? `Target ${targetRef} did not resolve.`, { targetRef });
      }
    } catch (error) {
      this.state.evidence.resolution = {
        ref: targetRef,
        status: 'unresolved',
        capturedAt: Date.now(),
        message: errorMessage(error),
      };
      this.state.browser.activeTargetRef = targetRef;
      this.addActivity('error', 'resolution', 'Target could not be highlighted', errorMessage(error), { targetRef });
    }
    await this.refreshSignals();
    this.emitState();
    return this.getState();
  }

  async refresh(): Promise<StudioState> {
    await this.refreshSignals();
    this.emitState();
    return this.getState();
  }

  private async loadWorkspace(workspacePath: string, announce: boolean): Promise<void> {
    const root = path.resolve(workspacePath);
    let store: WorkspaceStore;
    let configured = true;
    let configUsable = true;
    let issues: WorkspaceIssue[] = [];
    try {
      store = await WorkspaceStore.open(root);
    } catch (error) {
      configured = false;
      if (!(error instanceof WorkspaceError && error.code === 'PATH_NOT_FOUND')) {
        configUsable = false;
        issues = toIssues(error, '.agrune/workspace.json');
      }
      const baseUrl = root === this.state.workspace.path ? this.state.workspace.baseUrl : DEMO_URL;
      store = new WorkspaceStore(createWorkspaceConfig({ root, baseUrl }));
    }

    this.workspaceStore = store;
    this.workspaceConfigIssues = issues;
    this.workspaceConfigUsable = configUsable;
    this.state.workspace = {
      name: path.basename(store.config.root) || store.config.root,
      path: store.config.root,
      baseUrl: store.config.baseUrl,
      manifestPath: store.config.manifestPath,
      scenarioDir: store.config.scenarioDir,
      artifactDir: store.config.artifactDir,
      configured,
      issues,
    };
    this.clearWorkspaceBoundState(store.config.baseUrl, announce);
    await this.reloadScenarioLibrary(undefined, {
      suppressMissingRootIssue: !announce && !configured && configUsable,
    });
    await this.rebindSessionToWorkspace();
    if (announce) {
      this.addActivity(
        issues.length > 0 ? 'warning' : 'success',
        'system',
        'Workspace opened',
        configured ? store.config.root : `${store.config.root} (defaults in memory)`,
      );
    }
    this.emitState();
  }

  private async reloadScenarioLibrary(
    preferredKey?: string,
    options: { suppressMissingRootIssue?: boolean } = {},
  ): Promise<void> {
    const items = builtInItems();
    const issues = [...this.workspaceConfigIssues];
    let summaries: ScenarioFileSummary[] = [];
    if (this.workspaceConfigUsable) {
      try {
        summaries = await this.workspaceStore.scenarios.list();
      } catch (error) {
        const isOnboardingPlaceholderMissing =
          options.suppressMissingRootIssue === true &&
          error instanceof WorkspaceError &&
          error.code === 'PATH_NOT_FOUND';
        if (!isOnboardingPlaceholderMissing) {
          issues.push(...toIssues(error, this.state.workspace.scenarioDir));
        }
      }
    }

    for (const summary of summaries) {
      if (!summary.valid) {
        const errors = summary.errors ?? [{ path: summary.path, message: 'Invalid scenario document' }];
        for (const issue of errors) {
          issues.push({ path: `${summary.path}${issue.path ? `:${issue.path}` : ''}`, message: issue.message });
        }
        continue;
      }
      try {
        const file = await this.workspaceStore.scenarios.read(summary.path);
        items.push({
          key: scenarioKey('workspace', file.path),
          source: 'workspace',
          readOnly: false,
          fileName: file.path,
          document: file.scenario,
          modifiedAt: file.modifiedAt,
        });
      } catch (error) {
        issues.push(...toIssues(error, summary.path));
      }
    }

    this.state.workspace.issues = [...new Map(issues.map((issue) => [`${issue.path}\u0000${issue.message}`, issue])).values()];
    this.state.scenarios = items;
    const selected = preferredKey ?? this.state.selectedScenarioKey;
    this.state.selectedScenarioKey = items.some((item) => item.key === selected) ? selected : (items[0]?.key ?? '');
  }

  private clearWorkspaceBoundState(baseUrl: string, resetActivity: boolean): void {
    this.runActivityStartId = undefined;
    this.state.run = { status: 'idle', currentStepIndex: -1, steps: [] };
    this.state.evidence = { artifacts: [] };
    this.state.diagnostics = { console: [], network: [] };
    this.state.browser = {
      connected: false,
      loading: false,
      headed: true,
      url: baseUrl,
      title: '',
      targetCount: 0,
      groupCount: 0,
      targets: [],
      groups: [],
    };
    if (resetActivity) {
      this.state.activity = [];
      this.addActivity(
        'neutral',
        'system',
        'Workspace context initialized',
        this.state.workspace.path,
      );
    }
  }

  private async rebindSessionToWorkspace(): Promise<void> {
    const session = this.session;
    if (!session) return;
    this.state.browser.loading = true;
    this.emitState();
    try {
      // A fresh tab prevents console, network, manifest snapshot, and page
      // history from the previous workspace leaking into the new one.
      await session.closeAll();
      await session.open(this.state.workspace.baseUrl);
      await session.page().waitForTimeout(SETTLE_MS);
      await this.refreshSignals();
      this.addActivity('success', 'system', 'Browser rebound to workspace', this.state.workspace.baseUrl);
    } catch (error) {
      this.state.browser.loading = false;
      await this.refreshSignals();
      this.addActivity('error', 'error', 'Workspace browser navigation failed', errorMessage(error));
    }
  }

  private async ensureSession(): Promise<BrowserSession> {
    if (this.session) return this.session;
    this.state.engine = { status: 'starting', message: 'Starting headed Chromium…' };
    this.emitState();
    try {
      const { BrowserSession: Session } = await import('agrune');
      const session = new Session(false);
      await session.start();
      this.session = session;
      this.state.engine = { status: 'ready', message: 'Headed Chromium is ready' };
      this.addActivity('success', 'system', 'Browser engine ready', 'The real Chromium window is controlled by Agrune.');
      this.emitState();
      return session;
    } catch (error) {
      this.state.engine = { status: 'error', message: errorMessage(error) };
      this.addActivity('error', 'error', 'Browser engine failed to start', errorMessage(error));
      this.emitState();
      throw error;
    }
  }

  private beginRun(scenario: Scenario, singleStep: boolean, sourceScenarioKey?: string): void {
    this.runLoopActive = true;
    this.stopRequested = false;
    this.stepPermits = singleStep ? 1 : 0;
    const runId = `run-${Date.now()}`;
    const startedAt = Date.now();
    this.state.run = {
      id: runId,
      status: singleStep ? 'paused' : 'running',
      ...(sourceScenarioKey ? { scenarioKey: sourceScenarioKey } : {}),
      scenarioName: scenario.name,
      document: structuredClone(scenario),
      startedAt,
      currentStepIndex: -1,
      steps: scenario.steps.map((step, index) => this.stepState(step, index)),
    };
    // Evidence in the inspector always belongs to the current run. Historical
    // artifacts remain on disk and in their run logs, not mixed into this run.
    this.state.evidence = { artifacts: [] };
    this.state.diagnostics = { console: [], network: [] };
    this.state.browser.activeTargetRef = undefined;
    this.addActivity('info', 'system', singleStep ? 'Step mode armed' : 'Scenario started', scenario.name);
    this.runActivityStartId = this.state.activity[0]?.id;
    this.emitState();
    void this.executeScenario(scenario);
  }

  private async executeScenario(scenario: Scenario): Promise<void> {
    const runStartedAt = this.state.run.startedAt ?? Date.now();
    let finalStatus: TerminalRunStatus = 'failed';
    try {
      const session = await this.ensureSession();
      // Start tracing before the first navigation so redirects, load failures,
      // and manifest-pin failures are included in the diagnostic evidence.
      await this.startTraceIfConfigured();
      if (scenario.url) {
        this.state.browser.loading = true;
        this.emitState();
        if (session.tabCount === 0) await session.open(scenario.url);
        else await session.navigate(scenario.url);
      } else if (session.tabCount === 0) {
        await session.open(this.state.workspace.baseUrl);
      }
      await session.page().bringToFront();
      await session.page().waitForTimeout(SETTLE_MS);
      await this.verifyManifestPin(scenario);
      await this.refreshSignals();
      this.emitState();

      for (let index = 0; index < scenario.steps.length; index += 1) {
        await this.waitForPermission();
        if (this.stopRequested) break;

        const step = scenario.steps[index]!;
        const stepState = this.state.run.steps[index]!;
        this.state.run.currentStepIndex = index;
        this.state.run.currentStepId = stepState.id;
        stepState.status = 'running';
        stepState.startedAt = Date.now();
        this.addActivity(
          'info',
          isAssertionStep(step) ? 'assertion' : 'action',
          stepState.summary,
          undefined,
          { stepId: stepState.id, targetRef: stepState.targetRef },
        );
        // Publish the running boundary before target resolution. Resolution
        // can await snapshots or overlays, and the renderer must disable its
        // Step control before any of that asynchronous work begins.
        this.emitState();
        await this.focusTargetForStep(step, stepState.id);
        this.emitState();

        try {
          const execution = await executeScenarioStep(session as ScenarioRuntime, step, {
            scenario,
            runStartedAt,
            recoverWithPlaywright: (request) => recoverScenarioActionWithPlaywright(session.page(), request),
          });
          if (execution.recovery) {
            const recovery = execution.recovery;
            const ref = getStepTargetRef(step) ?? 'unknown target';
            this.state.browser.activeTargetRef = ref;
            this.state.evidence.resolution = {
              ref,
              status: 'recovered',
              capturedAt: Date.now(),
              message: recovery.description,
              recovery: {
                engine: 'playwright',
                causeCode: recovery.causeCode,
                strategy: recovery.locator.by,
                query: recovery.description,
                matchCount: recovery.matchCount,
              },
            };
            this.addActivity(
              'warning',
              'resolution',
              'Playwright recovered an unresolved target',
              `${recovery.description} · exactly one match`,
              { stepId: stepState.id, targetRef: ref },
            );
          }
          if (isActionStep(step) && step.do === 'navigate') await this.verifyManifestPin(scenario);
          await session.page().waitForTimeout(SETTLE_MS);
          stepState.status = 'passed';
          stepState.durationMs = Date.now() - stepState.startedAt;
          this.addActivity(
            'success',
            isAssertionStep(step) ? 'assertion' : 'action',
            `${stepState.summary} passed`,
            `${stepState.durationMs} ms`,
            { stepId: stepState.id, targetRef: stepState.targetRef, durationMs: stepState.durationMs },
          );
        } catch (error) {
          stepState.status = 'failed';
          stepState.durationMs = Date.now() - stepState.startedAt;
          stepState.error = errorMessage(error);
          this.state.run.status = 'failed';
          this.state.run.error = errorMessage(error);
          this.addActivity('error', 'error', `${stepState.summary} failed`, errorMessage(error), {
            stepId: stepState.id,
            targetRef: stepState.targetRef,
            durationMs: stepState.durationMs,
          });
          break;
        }

        await this.refreshSignals();
        this.emitState();
      }

      if (this.stopRequested) {
        this.markQueuedStepsSkipped();
        // Keep the public state non-runnable until traces, screenshots, and the
        // run log have all finished writing in the finally block.
        this.state.run.status = 'stopping';
        finalStatus = 'stopped';
      } else if (this.state.run.status !== 'failed') {
        finalStatus = 'passed';
        this.state.run.status = 'finalizing';
        this.addActivity(
          'info',
          'system',
          'Finalizing run evidence',
          'All semantic steps passed. Saving diagnostics and run artifacts before the run becomes terminal.',
        );
        this.emitState();
      } else {
        this.markQueuedStepsSkipped();
        finalStatus = 'failed';
      }
    } catch (error) {
      this.state.run.status = 'failed';
      finalStatus = 'failed';
      this.state.run.error = errorMessage(error);
      this.markQueuedStepsSkipped();
      this.addActivity('error', 'error', 'Run could not start', errorMessage(error));
    } finally {
      const failed = finalStatus === 'failed';
      try {
        await this.captureRunArtifacts(failed);
        await this.refreshSignals();
        if (finalStatus === 'passed') {
          this.addActivity('success', 'system', 'Scenario passed', scenario.name);
        }
        const finishedAt = Date.now();
        await this.persistRunLog(finalStatus, finishedAt);
        this.state.run.finishedAt = finishedAt;
      } finally {
        this.state.run.status = finalStatus;
        this.state.run.finishedAt ??= Date.now();
        this.runLoopActive = false;
        this.stepPermits = 0;
        this.releaseGate();
        if (!failed && this.state.evidence.resolution?.status !== 'recovered') {
          this.state.browser.activeTargetRef = undefined;
          this.state.evidence.resolution = undefined;
        }
        this.emitState();
      }
    }
  }

  private async waitForPermission(): Promise<void> {
    while (this.state.run.status === 'paused' && this.stepPermits === 0 && !this.stopRequested) {
      await new Promise<void>((resolve) => this.gateResolvers.push(resolve));
    }
    if (this.state.run.status === 'paused' && this.stepPermits > 0) this.stepPermits -= 1;
  }

  private releaseGate(): void {
    const pending = this.gateResolvers.splice(0);
    for (const resolve of pending) resolve();
  }

  private async focusTargetForStep(step: ScenarioStep, stepId: string): Promise<void> {
    const ref = getStepTargetRef(step);
    if (!ref) {
      if (this.state.evidence.resolution?.status !== 'recovered') {
        this.state.browser.activeTargetRef = undefined;
        this.state.evidence.resolution = undefined;
      }
      return;
    }
    await this.captureResolution(ref, true, stepId);
  }

  private async captureResolution(ref: string, highlight: boolean, stepId?: string): Promise<void> {
    const session = await this.ensureSession();
    const capturedAt = Date.now();
    this.state.browser.activeTargetRef = ref;
    this.state.evidence.resolution = { ref, status: 'pending', capturedAt };
    let target: ManifestTargetView | undefined;
    let snapshotError: unknown;
    try {
      const snapshot = await session.snapshot();
      this.applySnapshot(snapshot);
      target = this.state.browser.targets.find((candidate) => matchesTargetRef(candidate, ref));
    } catch (error) {
      snapshotError = error;
    }

    let highlightError: unknown;
    if (highlight) {
      try {
        await session.highlight(undefined, ref);
      } catch (error) {
        highlightError = error;
      }
    }

    if ((target?.domResolved ?? false) || (highlight && highlightError === undefined)) {
      this.state.evidence.resolution = {
        ref,
        status: 'resolved',
        capturedAt,
        ...(target ? { target } : {}),
        ...(highlightError ? { message: `Resolved, but the browser highlight was unavailable: ${errorMessage(highlightError)}` } : {}),
      };
      this.addActivity('success', 'resolution', 'Manifest ref resolved', ref, { stepId, targetRef: ref });
    } else {
      const error = highlightError ?? snapshotError ?? new Error(`Manifest target ${JSON.stringify(ref)} did not resolve.`);
      this.state.evidence.resolution = {
        ref,
        status: 'unresolved',
        capturedAt,
        message: errorMessage(error),
      };
      this.addActivity('error', 'resolution', 'Manifest ref unresolved', errorMessage(error), { stepId, targetRef: ref });
    }
    if (session.tabCount > 0) await session.page().bringToFront();
  }

  private async verifyManifestPin(scenario: Scenario): Promise<void> {
    if (!this.session || this.session.tabCount === 0) throw new Error('No active browser page.');
    const snapshot = await this.session.snapshot();
    if (snapshot.schemaVersion !== scenario.manifest.schemaVersion) {
      throw new Error(`Manifest schema is v${snapshot.schemaVersion}; scenario requires v${scenario.manifest.schemaVersion}.`);
    }
    if (scenario.manifest.origin) {
      const actual = new URL(this.session.page().url()).origin;
      if (actual !== scenario.manifest.origin) {
        throw new Error(`Active origin ${JSON.stringify(actual)} does not match pinned origin ${JSON.stringify(scenario.manifest.origin)}.`);
      }
    }
    if (scenario.manifest.appVersion) {
      throw new Error(`Manifest appVersion ${JSON.stringify(scenario.manifest.appVersion)} cannot be verified by this runtime.`);
    }
  }

  private async afterBrowserMutation(): Promise<void> {
    await this.session?.page().waitForTimeout(SETTLE_MS).catch(() => undefined);
    this.state.browser.loading = false;
    await this.refreshSignals();
    this.emitState();
  }

  private async refreshSignals(): Promise<void> {
    const session = this.session;
    if (!session || session.tabCount === 0) {
      this.state.browser.connected = false;
      this.state.browser.loading = false;
      return;
    }

    const page = session.page();
    this.state.browser.connected = true;
    this.state.browser.loading = false;
    this.state.browser.url = page.url();
    this.state.browser.title = await page.title().catch(() => '');

    let snapshot: PageSnapshot | null = null;
    try {
      snapshot = await session.snapshot();
    } catch (error) {
      this.addActivity('error', 'error', 'Runtime manifest snapshot failed', errorMessage(error));
    }
    if (snapshot) this.applySnapshot(snapshot);
    else {
      this.state.browser.targetCount = 0;
      this.state.browser.groupCount = 0;
      this.state.browser.targets = [];
      this.state.browser.groups = [];
      this.state.browser.snapshotVersion = undefined;
      this.state.browser.capturedAt = undefined;
    }

    const diagnosticBoundary = this.state.run.startedAt;
    const diagnosticEnd = this.state.run.finishedAt;
    this.state.diagnostics.console = session
      .consoleMessages(undefined, { level: 'debug', all: false })
      .filter((item) => (
        (diagnosticBoundary === undefined || item.timestamp >= diagnosticBoundary) &&
        (diagnosticEnd === undefined || item.timestamp <= diagnosticEnd)
      ))
      .slice(-MAX_DIAGNOSTICS)
      .map((item) => ({ level: item.level, text: item.text, timestamp: item.timestamp }));
    this.state.diagnostics.network = session
      .networkRequests(undefined, { includeStatic: false, all: false })
      .filter((item) => (
        (diagnosticBoundary === undefined || item.timestamp >= diagnosticBoundary) &&
        (diagnosticEnd === undefined || item.timestamp <= diagnosticEnd)
      ))
      .slice(-MAX_DIAGNOSTICS)
      .map((item) => ({
        method: item.method,
        url: item.url,
        ...(item.status !== undefined ? { status: item.status } : {}),
        ...(item.failureText ? { failureText: item.failureText } : {}),
        timestamp: item.timestamp,
      }));
  }

  private applySnapshot(snapshot: PageSnapshot): void {
    this.state.browser.url = snapshot.url;
    this.state.browser.title = snapshot.title;
    this.state.browser.snapshotVersion = snapshot.version;
    this.state.browser.capturedAt = snapshot.capturedAt;
    this.state.browser.targetCount = snapshot.targets.length;
    this.state.browser.groupCount = snapshot.groups.length;
    this.state.browser.targets = snapshot.targets.map(targetView);
    this.state.browser.groups = snapshot.groups.map((group) => ({
      groupId: group.groupId,
      ...(group.groupName ? { name: group.groupName } : {}),
      ...(group.groupDesc ? { description: group.groupDesc } : {}),
      targetIds: [...group.targetIds],
    }));
  }

  private async startTraceIfConfigured(): Promise<void> {
    if (!this.state.workspace.configured || !this.session || this.tracingActive) return;
    try {
      await this.session.tracingStart();
      this.tracingActive = true;
    } catch (error) {
      this.addActivity('warning', 'artifact', 'Trace capture was unavailable', errorMessage(error));
    }
  }

  private async captureRunArtifacts(failed: boolean): Promise<void> {
    const session = this.session;
    const runId = this.state.run.id;
    if (!session || !runId || !this.state.workspace.configured) return;

    if (failed && session.tabCount > 0) {
      try {
        const screenshotPath = await this.workspaceStore.artifactPath(`runs/${runId}/failure.png`);
        try {
          await session.screenshot(undefined, screenshotPath, { fullPage: true, type: 'png' });
        } catch (fullPageError) {
          try {
            await session.screenshot(undefined, screenshotPath, { fullPage: false, type: 'png' });
          } catch (viewportError) {
            throw new Error(
              `Full-page screenshot failed (${errorMessage(fullPageError)}); viewport fallback also failed (${errorMessage(viewportError)}).`,
            );
          }
          this.addActivity(
            'warning',
            'artifact',
            'Viewport failure screenshot saved',
            `Full-page capture was unavailable: ${errorMessage(fullPageError)}`,
          );
        }
        if (process.platform !== 'win32') await chmod(screenshotPath, 0o600);
        this.addArtifact({
          id: `${runId}-failure`,
          kind: 'screenshot',
          label: 'Failure screenshot',
          path: screenshotPath,
          createdAt: Date.now(),
        });
      } catch (error) {
        this.addActivity('warning', 'artifact', 'Failure screenshot could not be saved', errorMessage(error));
      }
    }

    if (this.tracingActive) {
      try {
        const tracePath = await this.workspaceStore.artifactPath(`runs/${runId}/trace.zip`);
        await session.tracingStop(tracePath);
        if (process.platform !== 'win32') await chmod(tracePath, 0o600);
        this.addArtifact({
          id: `${runId}-trace`,
          kind: 'trace',
          label: 'Playwright trace',
          path: tracePath,
          createdAt: Date.now(),
        });
      } catch (error) {
        this.addActivity('warning', 'artifact', 'Trace could not be saved', errorMessage(error));
      } finally {
        this.tracingActive = false;
      }
    }
  }

  private async persistRunLog(status: TerminalRunStatus, finishedAt: number): Promise<void> {
    const run = this.state.run;
    const runId = run.id;
    const startedAt = run.startedAt;
    if (!this.state.workspace.configured || !runId || startedAt === undefined) return;

    try {
      const runLogPath = await this.workspaceStore.artifactPath(`runs/${runId}/run.json`);
      const resolution = this.state.evidence.resolution;
      const runActivityStartIndex = this.runActivityStartId
        ? this.state.activity.findIndex((entry) => entry.id === this.runActivityStartId)
        : -1;
      const runActivity = runActivityStartIndex >= 0
        ? this.state.activity.slice(0, runActivityStartIndex + 1)
        : this.state.activity.filter((entry) => entry.timestamp >= startedAt);
      const runArtifacts = this.state.evidence.artifacts.filter(
        (artifact) => artifact.id.startsWith(`${runId}-`) && artifact.kind !== 'run-log',
      ).sort((left, right) => left.createdAt - right.createdAt);
      const document = {
        schema: 'agrune.run-log/v1',
        createdAt: Date.now(),
        sensitiveDataWarning:
          'Console text, network URLs, errors, screenshots, and traces may contain sensitive page data. Review before sharing.',
        run: {
          id: runId,
          status,
          scenario: {
            ...(run.document?.id ? { id: run.document.id } : {}),
            name: run.scenarioName ?? run.document?.name ?? 'Untitled scenario',
          },
          ...(run.scenarioKey ? { scenarioKey: run.scenarioKey } : {}),
          startedAt,
          finishedAt,
          durationMs: Math.max(0, finishedAt - startedAt),
          currentStepIndex: run.currentStepIndex,
          ...(run.currentStepId ? { currentStepId: run.currentStepId } : {}),
          ...(run.error ? { error: run.error } : {}),
        },
        steps: structuredClone(run.steps),
        browser: {
          url: this.state.browser.url,
          title: this.state.browser.title,
        },
        activity: runActivity
          .map((entry) => structuredClone(entry))
          // Activity is stored newest-first. Reversing preserves insertion
          // order even when several semantic events share one millisecond.
          .reverse(),
        diagnostics: {
          console: this.state.diagnostics.console
            .filter((entry) => entry.timestamp >= startedAt)
            .map((entry) => ({ ...entry })),
          network: this.state.diagnostics.network
            .filter((entry) => entry.timestamp >= startedAt)
            .map((entry) => ({ ...entry })),
        },
        ...(resolution
          ? {
              resolution: {
                ref: resolution.ref,
                status: resolution.status,
                capturedAt: resolution.capturedAt,
                ...(resolution.message ? { message: resolution.message } : {}),
                ...(resolution.recovery ? { recovery: structuredClone(resolution.recovery) } : {}),
              },
            }
          : {}),
        artifacts: runArtifacts.map((artifact) => ({
          kind: artifact.kind,
          label: artifact.label,
          file: path.basename(artifact.path),
          createdAt: artifact.createdAt,
        })),
      };

      await writeRunLog(runLogPath, document);
      this.addArtifact({
        id: `${runId}-run-log`,
        kind: 'run-log',
        label: 'Run log',
        path: runLogPath,
        createdAt: Date.now(),
      });
    } catch (error) {
      this.addActivity('warning', 'artifact', 'Run log could not be saved', errorMessage(error));
    }
  }

  private addArtifact(artifact: ArtifactView): void {
    this.state.evidence.artifacts.unshift(artifact);
    this.state.evidence.artifacts = this.state.evidence.artifacts.slice(0, MAX_ARTIFACTS);
    this.addActivity('success', 'artifact', `${artifact.label} saved`, artifact.path);
  }

  private normalizeUrl(rawUrl: string): string {
    const value = rawUrl.trim();
    if (!value) return this.state.workspace.baseUrl;
    const withProtocol = /^https?:\/\//i.test(value) ? value : `http://${value}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Only HTTP(S) URLs are supported.');
    return parsed.toString();
  }

  private scenarioByKey(key: string): StudioScenarioItem | undefined {
    return this.state.scenarios.find((scenario) => scenario.key === key);
  }

  private validScenarioSourceKey(key: string | undefined): string | undefined {
    return key && this.scenarioByKey(key) ? key : undefined;
  }

  private stepState(step: ScenarioStep, index: number): StepRunState {
    const display = describeScenarioStep(step);
    return {
      index,
      id: step.id ?? `step-${index + 1}`,
      summary: display.detail ? `${display.title}: ${display.detail}` : display.title,
      family: display.family,
      kind: display.kind,
      ...(display.targetRef ? { targetRef: display.targetRef } : {}),
      status: 'queued',
    };
  }

  private resetRun(): void {
    this.runActivityStartId = undefined;
    this.state.run = { status: 'idle', currentStepIndex: -1, steps: [] };
    this.state.evidence.resolution = undefined;
    this.state.browser.activeTargetRef = undefined;
  }

  private failBeforeRun(title: string, error: unknown): void {
    this.state.run = {
      status: 'failed',
      currentStepIndex: -1,
      steps: [],
      finishedAt: Date.now(),
      error: errorMessage(error),
    };
    this.addActivity('error', 'error', title, errorMessage(error));
    this.emitState();
  }

  private markQueuedStepsSkipped(): void {
    for (const step of this.state.run.steps) {
      if (step.status === 'queued') step.status = 'skipped';
    }
  }

  private addActivity(
    tone: ActivityEntry['tone'],
    kind: ActivityEntry['kind'],
    title: string,
    detail?: string,
    context: Pick<ActivityEntry, 'stepId' | 'targetRef' | 'durationMs'> = {},
  ): void {
    this.activityCounter += 1;
    this.state.activity.unshift({
      id: `activity-${Date.now()}-${this.activityCounter}`,
      timestamp: Date.now(),
      tone,
      kind,
      title,
      ...(detail ? { detail } : {}),
      ...(context.stepId ? { stepId: context.stepId } : {}),
      ...(context.targetRef ? { targetRef: context.targetRef } : {}),
      ...(context.durationMs !== undefined ? { durationMs: context.durationMs } : {}),
    });
    this.state.activity = this.state.activity.slice(0, MAX_ACTIVITY);
  }

  private emitState(): void {
    this.publishState(this.getState());
  }
}

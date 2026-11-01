import { Check, Info, TriangleAlert, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import {
  createEmptyScenario,
  ensureScenarioEditorIds,
  type Scenario,
} from '../scenario';
import type { ArtifactView, OpenArtifactRequest, StudioScenarioItem, StudioState } from '../shared/contracts';
import { ScenarioEditor } from './ScenarioEditor';
import {
  StudioNext,
  createStudioNextScenario,
  type StudioNextEvidenceItem,
  type StudioNextGap,
  type StudioNextResolution,
  type StudioNextRunStatus,
  type StudioNextTimelineEntry,
  type StudioNextViewModel,
} from './StudioNext';
import './app-next.css';

interface EditorSession {
  scenario: Scenario;
  scenarioKey?: string;
  fileName?: string;
  initialStepIndex: number;
  initialFocusTarget?: boolean;
}

interface ScenarioSourceContext {
  document: Scenario;
  scenarioKey?: string;
  fileName?: string;
  readOnly?: boolean;
}

interface ToastState {
  id: number;
  tone: 'info' | 'success' | 'error';
  title: string;
  detail?: string;
}

const LOADING_MODEL: StudioNextViewModel = {
  phase: 'loading',
  workspace: {
    id: 'loading',
    name: 'Agrune Studio',
    path: '',
    baseUrl: '',
    configured: false,
    connected: false,
    sessionLabel: 'Starting headed Chromium',
    manifest: { filename: 'manifest.json', groups: 0, targets: 0, coverage: 0, health: 'warning' },
  },
  scenarios: [],
  gaps: [],
  timeline: [],
  run: { status: 'idle', elapsedMs: 0, progress: 0, browserLabel: 'Chromium · external window' },
  evidence: [],
};

const EPHEMERAL_RUN_KEY = 'run:ephemeral-draft';

export function artifactOpenMode(kind: ArtifactView['kind']): OpenArtifactRequest['mode'] {
  return kind === 'screenshot' ? 'open' : 'reveal';
}

function isActiveRunStatus(status?: StudioState['run']['status']): boolean {
  return status === 'running' || status === 'paused' || status === 'stopping' || status === 'finalizing';
}

function formatClock(timestamp: number): string {
  return new Intl.DateTimeFormat('en', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(timestamp);
}

function formatRelativeTime(timestamp?: number): string {
  if (!timestamp) return 'Not run';
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 5_000) return 'Just now';
  if (elapsed < 60_000) return `${Math.floor(elapsed / 1_000)} sec ago`;
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  return `${Math.floor(elapsed / 3_600_000)} hr ago`;
}

function activityKind(kind: StudioState['activity'][number]['kind']): StudioNextTimelineEntry['kind'] {
  if (kind === 'artifact') return 'system';
  if (kind === 'error') return 'error';
  return kind;
}

function activityStatus(tone: StudioState['activity'][number]['tone']): StudioNextTimelineEntry['status'] {
  if (tone === 'success') return 'success';
  if (tone === 'warning') return 'warning';
  if (tone === 'error') return 'error';
  return 'pending';
}

function resolutionModel(state: StudioState): StudioNextResolution | undefined {
  const resolution = state.evidence.resolution;
  if (!resolution) return undefined;
  const recovered = resolution.status === 'recovered' ? resolution.recovery : undefined;
  const selector = recovered?.query || resolution.target?.selector || resolution.message || resolution.ref;
  return {
    targetId: resolution.ref,
    action: resolution.target?.actionKinds.join(', ') || (recovered ? 'Playwright recovery' : 'manifest lookup'),
    outcome: resolution.status,
    policy: recovered
      ? `Manifest first · Playwright ${recovered.strategy} · unique match required`
      : resolution.target?.sensitive
      ? 'Sensitive · value disclosure blocked · unique match required'
      : 'Manifest declared · unique match required',
    candidates: [
      {
        id: `candidate-${resolution.ref}`,
        strategy: recovered ? `Playwright ${recovered.strategy}` : 'manifest selector ladder',
        query: selector,
        outcome: resolution.status === 'resolved' || resolution.status === 'recovered'
          ? 'matched'
          : resolution.status === 'pending'
            ? 'pending'
            : 'missed',
        matchCount: recovered?.matchCount ?? (resolution.status === 'resolved' ? 1 : 0),
      },
    ],
  };
}

function evidenceModel(state: StudioState): StudioNextEvidenceItem[] {
  if (!state.run.startedAt) return [];
  const consoleErrors = state.diagnostics.console.filter((entry) => entry.level === 'error').length;
  const failedRequests = state.diagnostics.network.filter((entry) => entry.failureText || (entry.status ?? 0) >= 400).length;
  return [
    ...state.evidence.artifacts.map((artifact): StudioNextEvidenceItem => ({
      id: artifact.id,
      kind: artifact.kind,
      title: artifact.label,
      detail: artifact.path,
      tone: artifact.kind === 'screenshot' && state.run.status === 'failed' ? 'error' : 'neutral',
      action: artifactOpenMode(artifact.kind),
    })),
    {
      id: 'console-summary',
      kind: 'console',
      title: consoleErrors ? `${consoleErrors} console error${consoleErrors === 1 ? '' : 's'}` : 'Console is clean',
      detail: `${state.diagnostics.console.length} captured message${state.diagnostics.console.length === 1 ? '' : 's'}`,
      tone: consoleErrors ? 'error' : 'success',
      action: 'expand',
      entries: state.diagnostics.console.slice(-50).map((entry) => `${formatClock(entry.timestamp)}  ${entry.level.toUpperCase()}  ${entry.text}`),
    },
    {
      id: 'network-summary',
      kind: 'network',
      title: `${state.diagnostics.network.length} network request${state.diagnostics.network.length === 1 ? '' : 's'}`,
      detail: failedRequests ? `${failedRequests} failed or returned an error` : 'No failed requests captured',
      tone: failedRequests ? 'warning' : 'success',
      action: 'expand',
      entries: state.diagnostics.network.slice(-50).map((entry) => {
        const result = entry.failureText ?? (entry.status !== undefined ? String(entry.status) : 'pending');
        return `${formatClock(entry.timestamp)}  ${entry.method}  ${result}  ${entry.url}`;
      }),
    },
  ];
}

function gapModel(state: StudioState): StudioNextGap[] {
  const resolution = state.evidence.resolution;
  if (resolution?.status === 'unresolved' || resolution?.status === 'ambiguous') {
    return [{
      id: `gap-${resolution.ref}`,
      kind: 'manifest-target',
      title: `Unresolved manifest target`,
      pagePath: state.browser.url || state.workspace.baseUrl,
      action: resolution.status,
      occurrences: 1,
      severity: 'error',
      suggestedTarget: resolution.ref,
    }];
  }
  return state.workspace.issues.slice(0, 8).map((issue, index) => ({
    id: `workspace-issue-${index}`,
    kind: 'workspace',
    title: issue.message,
    pagePath: issue.path || state.workspace.path,
    action: 'workspace validation',
    occurrences: 1,
    severity: 'warning',
  }));
}

function toViewModel(state: StudioState, now: number, selectedStepId?: string, takeover = false, takeoverPending = false): StudioNextViewModel {
  const runScenario = state.scenarios.find((item) => item.key === state.run.scenarioKey);
  const runDocument = state.run.document;
  const runMatches = (item: StudioScenarioItem): boolean =>
    Boolean(state.run.scenarioKey) && item.key === state.run.scenarioKey;
  const stepStates = Object.fromEntries(state.run.steps.map((step) => [step.id, {
    status: step.status,
    durationMs: step.durationMs,
    error: step.error,
  }]));
  const runRuntime = {
    updatedLabel: formatRelativeTime(state.run.finishedAt ?? state.run.startedAt),
    lastRunStatus: state.run.status as StudioNextRunStatus,
    stepStates,
  };
  const scenarios = state.scenarios.map((item) => {
    const document = runMatches(item) && runDocument ? runDocument : item.document;
    const runtime = runMatches(item)
      ? runRuntime
      : { updatedLabel: item.modifiedAt ? formatRelativeTime(Date.parse(item.modifiedAt)) : item.source === 'built-in' ? 'Never run' : 'Saved' };
    return {
      ...createStudioNextScenario(document, {
        ...runtime,
        readOnly: item.readOnly,
        sourceLabel: item.source === 'built-in' ? 'Built in' : 'Workspace',
      }),
      id: item.key,
    };
  });
  if (runDocument && !state.run.scenarioKey) {
    scenarios.unshift({ ...createStudioNextScenario(runDocument, runRuntime), id: EPHEMERAL_RUN_KEY });
  }
  const resolvedCount = state.browser.targets.filter((target) => target.domResolved).length;
  const coverage = state.browser.targetCount ? Math.round((resolvedCount / state.browser.targetCount) * 100) : 0;
  const elapsedMs = state.run.startedAt
    ? Math.max(0, (state.run.finishedAt ?? now) - state.run.startedAt)
    : 0;
  const executedSteps = state.run.steps.filter((step) => step.status === 'passed' || step.status === 'failed').length;
  const progress = state.run.steps.length ? Math.round((executedSteps / state.run.steps.length) * 100) : 0;
  const visibleTargets = state.browser.targets.filter((target) => target.visible).map((target) => target.targetId);
  const groups = state.browser.groups.map((group) => group.groupId);
  const timeline = (state.run.startedAt ? state.activity.filter((entry) => (
    entry.timestamp >= state.run.startedAt! &&
    (state.run.finishedAt === undefined || entry.timestamp <= state.run.finishedAt)
  )) : [])
    .sort((left, right) => left.timestamp - right.timestamp)
    .slice(-80)
    .map((entry): StudioNextTimelineEntry => ({
      id: entry.id,
      timestamp: formatClock(entry.timestamp),
      kind: activityKind(entry.kind),
      title: entry.title,
      detail: entry.detail ?? '',
      target: entry.targetRef,
      stepId: entry.stepId,
      status: activityStatus(entry.tone),
      durationMs: entry.durationMs,
    }));
  const activeRunName = runDocument?.name ?? runScenario?.document.name ?? state.run.scenarioName;

  return {
    phase: 'ready',
    workspace: {
      id: state.workspace.path,
      name: state.workspace.name,
      path: state.workspace.path,
      baseUrl: state.workspace.baseUrl,
      configured: state.workspace.configured,
      connected: state.browser.connected,
      sessionLabel: state.browser.connected ? 'headed Chromium · live' : state.engine.message,
      manifest: {
        filename: state.workspace.manifestPath.split('/').at(-1) || 'manifest.json',
        groups: state.browser.groupCount,
        targets: state.browser.targetCount,
        coverage,
        health: state.engine.status === 'error' ? 'error' : coverage === 100 ? 'healthy' : 'warning',
      },
    },
    scenarios,
    gaps: gapModel(state),
    selectedScenarioId: runDocument && !state.run.scenarioKey ? EPHEMERAL_RUN_KEY : state.selectedScenarioKey,
    selectedStepId: selectedStepId ?? state.run.currentStepId,
    timeline,
    run: {
      id: state.run.id,
      status: state.run.status,
      currentStepId: state.run.currentStepId,
      elapsedMs,
      progress,
      startedLabel: state.run.startedAt ? formatClock(state.run.startedAt) : undefined,
      browserLabel: 'Chromium · external window',
    },
    perception: state.browser.connected ? {
      snapshotId: `snapshot-${state.browser.snapshotVersion ?? 0}`,
      url: state.browser.url,
      capturedLabel: state.browser.capturedAt ? formatRelativeTime(state.browser.capturedAt) : 'Awaiting snapshot',
      summary: `${visibleTargets.length} visible manifest targets across ${groups.length} active group${groups.length === 1 ? '' : 's'}. ${activeRunName ? `Running ${activeRunName}.` : 'Ready for a semantic scenario.'}`,
      visibleTargets: visibleTargets.slice(0, 18),
      totalVisibleTargets: visibleTargets.length,
      activeTargetRef: state.browser.activeTargetRef,
      groups,
      tokenCount: Math.ceil(JSON.stringify(state.browser.targets).length / 4),
    } : undefined,
    resolution: resolutionModel(state),
    evidence: evidenceModel(state),
    takeover,
    takeoverPending,
  };
}

export function App(): JSX.Element {
  const [state, setState] = useState<StudioState | null>(null);
  const [initError, setInitError] = useState<string>();
  const [selectedStepId, setSelectedStepId] = useState<string>();
  const [editor, setEditor] = useState<EditorSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [runningDraft, setRunningDraft] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [takeoverPending, setTakeoverPending] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [now, setNow] = useState(Date.now());
  const previousRunIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let active = true;
    void window.agruneStudio.getState().then((next) => {
      if (active) {
        setInitError(undefined);
        setState(next);
      }
    }).catch((error) => {
      if (active) {
        const message = error instanceof Error ? error.message : String(error);
        setInitError(message);
        showToast('error', 'Studio could not initialize', message);
      }
    });
    const unsubscribe = window.agruneStudio.onState((next) => {
      if (active) {
        setInitError(undefined);
        setState(next);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!state || (state.run.status !== 'running' && state.run.status !== 'paused' && state.run.status !== 'stopping' && state.run.status !== 'finalizing')) return;
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, [state?.run.status]);

  useEffect(() => {
    const runId = state?.run.id;
    if (runId === previousRunIdRef.current) return;
    previousRunIdRef.current = runId;
    // A new run follows its live step by default. Users can still select and
    // inspect another step after the run has started.
    setSelectedStepId(undefined);
  }, [state?.run.id]);

  useEffect(() => {
    if (!toast) return;
    if (toast.tone === 'error') return;
    const timeout = window.setTimeout(() => setToast((current) => current?.id === toast.id ? null : current), 4_200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const model = useMemo(() => {
    if (state) return toViewModel(state, now, selectedStepId, takeover, takeoverPending);
    if (initError) return { ...LOADING_MODEL, phase: 'error' as const, errorMessage: initError };
    return LOADING_MODEL;
  }, [initError, now, selectedStepId, state, takeover, takeoverPending]);
  const targetRefs = useMemo(() => state?.browser.targets.map((target) => target.targetId) ?? [], [state]);

  function showToast(tone: ToastState['tone'], title: string, detail?: string): void {
    setToast({ id: Date.now(), tone, title, detail });
  }

  async function update(
    action: () => Promise<StudioState>,
    failureTitle: string,
    options: { rethrow?: boolean } = {},
  ): Promise<StudioState | null> {
    try {
      const next = await action();
      setInitError(undefined);
      setState(next);
      return next;
    } catch (error) {
      if (options.rethrow) throw error;
      showToast('error', failureTitle, error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function retryInitialization(): Promise<void> {
    const next = await update(() => window.agruneStudio.refresh(), 'Studio still could not initialize');
    if (next) showToast('success', 'Studio reconnected', 'Workspace and browser state were refreshed.');
  }

  function sourceForKey(key: string): ScenarioSourceContext | undefined {
    if (key === EPHEMERAL_RUN_KEY && state?.run.document && !state.run.scenarioKey) {
      return { document: state.run.document };
    }
    const item = state?.scenarios.find((candidate) => candidate.key === key);
    if (!item) return undefined;
    return {
      document: state?.run.document && state.run.scenarioKey === item.key ? state.run.document : item.document,
      scenarioKey: item.key,
      readOnly: item.readOnly,
      ...(item.fileName ? { fileName: item.fileName } : {}),
    };
  }

  function openEditor(source: ScenarioSourceContext, initialStepIndex = 0, initialFocusTarget = false): void {
    const scenario = ensureScenarioEditorIds(source.document);
    if (source.readOnly) {
      scenario.id = `${scenario.id ?? 'scenario'}-workspace-${Date.now().toString(36)}`;
    }
    setEditor({
      scenario,
      ...(!source.readOnly && source.scenarioKey ? { scenarioKey: source.scenarioKey } : {}),
      ...(!source.readOnly && source.fileName ? { fileName: source.fileName } : {}),
      initialStepIndex,
      ...(initialFocusTarget ? { initialFocusTarget: true } : {}),
    });
  }

  function createScenario(): void {
    if (isActiveRunStatus(state?.run.status)) {
      showToast('info', 'Run context is locked', 'Stop the active run before creating a scenario.');
      return;
    }
    const id = `scenario-${Date.now().toString(36)}`;
    const scenario = createEmptyScenario('Untitled scenario', { id, url: state?.workspace.baseUrl });
    setEditor({ scenario, initialStepIndex: 0 });
  }

  function addStep(scenarioKey: string): void {
    if (isActiveRunStatus(state?.run.status)) {
      showToast('info', 'Run context is locked', 'Stop the active run before adding a step.');
      return;
    }
    const source = sourceForKey(scenarioKey);
    if (!source) return;
    const scenario = ensureScenarioEditorIds(source.document);
    if (source.readOnly) scenario.id = `${scenario.id ?? 'scenario'}-workspace-${Date.now().toString(36)}`;
    scenario.steps.push({ id: `step-${Date.now().toString(36)}`, do: 'click', ref: '' });
    setEditor({
      scenario,
      ...(!source.readOnly && source.scenarioKey ? { scenarioKey: source.scenarioKey } : {}),
      ...(!source.readOnly && source.fileName ? { fileName: source.fileName } : {}),
      initialStepIndex: scenario.steps.length - 1,
      initialFocusTarget: true,
    });
  }

  async function saveScenario(scenario: Scenario): Promise<void> {
    setSaving(true);
    try {
      const next = await update(
        () => window.agruneStudio.saveScenario({ scenario, fileName: editor?.fileName }),
        'Scenario could not be saved',
        { rethrow: true },
      );
      if (next) {
        setEditor(null);
        showToast('success', 'Scenario saved', `${scenario.name} is now in the workspace library.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function runDraft(scenario: Scenario): Promise<void> {
    if (takeover || takeoverPending) {
      throw new Error('Exit manual browser control before running this draft.');
    }
    const scenarioKey = editor?.scenarioKey;
    const previousRunId = state?.run.id;
    setRunningDraft(true);
    try {
      const next = await update(
        () => window.agruneStudio.runScenario({ scenario, ...(scenarioKey ? { scenarioKey } : {}) }),
        'Scenario could not start',
        { rethrow: true },
      );
      if (next?.run.id && next.run.id !== previousRunId) {
        setEditor(null);
        setTakeover(false);
        setTakeoverPending(false);
        showToast('info', 'Scenario started', 'Watch the controlled browser or follow the live timeline.');
        return;
      }
      if (next) {
        const message = 'Finish or stop the active run, then try the draft again. Your draft is still open.';
        throw new Error(message);
      }
    } finally {
      setRunningDraft(false);
    }
  }

  function selectStep(stepId: string): void {
    setSelectedStepId(stepId);
  }

  async function highlightTarget(targetRef: string): Promise<void> {
    if (isActiveRunStatus(state?.run.status)) {
      showToast('info', 'Target highlight is locked', 'Stop the active run before inspecting another target.');
      return;
    }
    const next = await update(() => window.agruneStudio.highlightTarget(targetRef), 'Target could not be highlighted');
    const resolution = next?.evidence.resolution;
    if (!resolution || resolution.ref !== targetRef) return;

    if (resolution.status === 'resolved' && !resolution.message) {
      showToast('info', 'Target highlighted', targetRef);
      return;
    }

    showToast('error', 'Target could not be highlighted', resolution.message ?? `${targetRef} did not resolve.`);
  }

  async function openBrowser(): Promise<void> {
    await update(() => window.agruneStudio.showBrowser(), 'Browser could not be opened');
  }

  async function changeManualControl(next: boolean): Promise<void> {
    if (next) {
      if (takeoverPending) return;
      setTakeoverPending(true);
      try {
        let paused = state;
        if (state?.run.status === 'running') {
          paused = await update(() => window.agruneStudio.pauseRun(), 'Run could not pause for manual control');
          if (!paused) return;
        }
        if (paused?.run.steps.some((step) => step.status === 'running')) {
          showToast('info', 'Manual control requested', 'Waiting for the current semantic step to finish before handing over the browser.');
          const deadline = Date.now() + 125_000;
          while (paused.run.steps.some((step) => step.status === 'running')) {
            if (Date.now() >= deadline) throw new Error('The current browser action did not reach a safe handoff boundary.');
            await new Promise((resolve) => window.setTimeout(resolve, 100));
            paused = await window.agruneStudio.getState();
            setState(paused);
          }
        }
        const visible = await update(() => window.agruneStudio.showBrowser(), 'Browser could not be opened for manual control');
        if (!visible) return;
        setTakeover(true);
        showToast('info', 'Manual browser control active', paused?.run.status === 'paused' ? 'The run is paused at a step boundary.' : 'Agrune will not start a run until you exit manual control.');
      } catch (error) {
        showToast('error', 'Manual control could not start', error instanceof Error ? error.message : String(error));
      } finally {
        setTakeoverPending(false);
      }
      return;
    }
    setTakeoverPending(false);
    setTakeover(false);
    const refreshed = await update(
      () => window.agruneStudio.refresh(),
      'Browser state could not refresh after manual control',
    );
    if (refreshed?.browser.connected && refreshed.browser.capturedAt) {
      showToast(
        'info',
        'Manual control ended',
        refreshed.run.status === 'paused'
          ? 'The run remains paused. Browser state is up to date; choose Resume when you are ready.'
          : 'Agrune can control the refreshed browser state again.',
      );
    } else if (refreshed) {
      showToast('error', 'Browser state could not refresh after manual control', 'The browser is offline or its runtime manifest snapshot was unavailable. Start or reload the browser, then refresh again.');
    }
  }

  async function openWorkspace(): Promise<void> {
    if (isActiveRunStatus(state?.run.status)) {
      showToast('info', 'Workspace is locked during a run', 'Stop the active run before switching workspaces.');
      return;
    }
    const previousPath = state?.workspace.path;
    const next = await update(() => window.agruneStudio.chooseWorkspace(), 'Workspace could not be opened');
    if (next && next.workspace.path !== previousPath) {
      setEditor(null);
      setSelectedStepId(undefined);
      setTakeover(false);
      setTakeoverPending(false);
    }
  }

  const actions = {
    onRetry: () => void retryInitialization(),
    onOpenWorkspace: () => void openWorkspace(),
    onSelectScenario: (key: string) => {
      if (isActiveRunStatus(state?.run.status)) {
        showToast('info', 'Run context is locked', 'Stop the active run before selecting another scenario.');
        return;
      }
      if (key === state?.selectedScenarioKey || key === EPHEMERAL_RUN_KEY) return;
      setSelectedStepId(undefined);
      void update(() => window.agruneStudio.selectScenario(key), 'Scenario could not be selected');
    },
    onSelectStep: selectStep,
    onCreateScenario: createScenario,
    onEditScenario: (key: string) => {
      if (isActiveRunStatus(state?.run.status)) {
        showToast('info', 'Run context is locked', 'Stop the active run before editing a scenario.');
        return;
      }
      const source = sourceForKey(key);
      if (source) openEditor(source);
    },
    onAddStep: addStep,
    onRepairReference: () => {
      if (isActiveRunStatus(state?.run.status)) {
        showToast('info', 'Run context is locked', 'Stop the active run before editing a scenario reference.');
        return;
      }
      const activeKey = state?.run.document && !state.run.scenarioKey ? EPHEMERAL_RUN_KEY : state?.selectedScenarioKey;
      const source = activeKey ? sourceForKey(activeKey) : undefined;
      if (!source) {
        showToast('error', 'Scenario reference is unavailable', 'Select the scenario that owns this unresolved target, then try again.');
        return;
      }
      const resolutionRef = state?.evidence.resolution?.ref;
      const matchingReferenceIndex = resolutionRef
        ? source.document.steps.findIndex((step) => 'ref' in step && step.ref === resolutionRef)
        : -1;
      const runStepIndex = state?.run.currentStepId
        ? source.document.steps.findIndex((step, index) => (step.id ?? `step-${index + 1}`) === state.run.currentStepId)
        : -1;
      const selectedStepIndex = selectedStepId
        ? source.document.steps.findIndex((step, index) => (step.id ?? `step-${index + 1}`) === selectedStepId)
        : -1;
      const targetStepIndex = matchingReferenceIndex >= 0
        ? matchingReferenceIndex
        : runStepIndex >= 0
          ? runStepIndex
          : selectedStepIndex;
      openEditor(source, targetStepIndex >= 0 ? targetStepIndex : Math.max(0, state?.run.currentStepIndex ?? 0), true);
      showToast('info', 'Editing the scenario reference', 'Manifest authoring is not available in Studio yet. Update this step’s ref, then rerun the draft.');
    },
    onRun: (key: string) => {
      if (takeover || takeoverPending) {
        showToast('info', 'Manual control is active', 'Exit manual browser control before starting a run.');
        return;
      }
      const source = sourceForKey(key);
      if (source) {
        void update(
          () => window.agruneStudio.runScenario({
            scenario: source.document,
            ...(source.scenarioKey ? { scenarioKey: source.scenarioKey } : {}),
          }),
          'Scenario could not start',
        );
      }
    },
    onPause: () => void update(() => window.agruneStudio.pauseRun(), 'Run could not be paused').then((next) => {
      if (next) showToast('info', 'Pause requested', 'The current semantic step will finish before execution pauses.');
    }),
    onResume: () => void update(() => window.agruneStudio.resumeRun(), 'Run could not resume'),
    onStep: (key: string) => {
      if (takeover || takeoverPending) {
        showToast('info', 'Manual control is active', 'Exit manual browser control before running a step.');
        return;
      }
      const source = sourceForKey(key);
      if (source) {
        void update(
          () => window.agruneStudio.stepRun({
            scenario: source.document,
            ...(source.scenarioKey ? { scenarioKey: source.scenarioKey } : {}),
          }),
          'Step could not run',
        );
      }
    },
    onStop: () => void update(() => window.agruneStudio.stopRun(), 'Run could not stop').then((next) => {
      if (next?.run.status === 'stopping') showToast('info', 'Stop requested', 'The current browser action and evidence finalization will finish first.');
    }),
    onTakeover: (next: boolean) => void changeManualControl(next),
    onOpenBrowser: () => void openBrowser(),
    onOpenManifest: () => void update(() => window.agruneStudio.refresh(), 'Manifest could not be refreshed').then((next) => {
      if (!next) return;
      if (!next.browser.connected || !next.browser.capturedAt) {
        showToast('error', 'Runtime manifest could not be refreshed', 'Start the controlled browser or reload the current page, then try again.');
        return;
      }
      showToast('success', 'Runtime manifest refreshed', `${next.browser.targetCount} targets are visible to Agrune on the current page.`);
    }),
    onHighlightTarget: (targetRef: string) => void highlightTarget(targetRef),
    onOpenEvidence: (evidenceId: string) => {
      const artifact = state?.evidence.artifacts.find((item) => item.id === evidenceId);
      if (!artifact) return;
      const mode = artifactOpenMode(artifact.kind);
      void window.agruneStudio.openArtifact({ path: artifact.path, mode }).then(() => {
        showToast('success', mode === 'reveal' ? 'Artifact revealed in Finder' : 'Artifact opened', artifact.label);
      }).catch((error) => {
        showToast('error', 'Artifact could not be opened', error instanceof Error ? error.message : String(error));
      });
    },
  };

  return (
    <>
      <StudioNext model={model} actions={actions} />
      {editor && (
        <ScenarioEditor
          open
          scenario={editor.scenario}
          targetRefs={targetRefs}
          initialStepIndex={editor.initialStepIndex}
          initialFocusTarget={editor.initialFocusTarget}
          saving={saving}
          running={runningDraft}
          {...(takeover || takeoverPending ? { runBlockedReason: 'Exit manual browser control before running this draft.' } : {})}
          onClose={() => setEditor(null)}
          onSave={saveScenario}
          onRun={runDraft}
        />
      )}
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}
    </>
  );
}

function Toast({ toast, onClose }: { toast: ToastState; onClose: () => void }): JSX.Element {
  const Icon = toast.tone === 'error' ? TriangleAlert : toast.tone === 'success' ? Check : Info;
  return (
    <div className={`studio-toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live={toast.tone === 'error' ? 'assertive' : 'polite'}>
      <span><Icon size={14} /></span>
      <div><strong>{toast.title}</strong>{toast.detail && <p>{toast.detail}</p>}</div>
      <button type="button" aria-label="Dismiss notification" onClick={onClose}><X size={13} /></button>
    </div>
  );
}

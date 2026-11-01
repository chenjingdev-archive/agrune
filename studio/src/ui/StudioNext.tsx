import {
  Activity,
  AlertCircle,
  Bot,
  Braces,
  Check,
  ChevronRight,
  CircleStop,
  Clock3,
  Code2,
  ExternalLink,
  Eye,
  FileCode2,
  FolderOpen,
  Hand,
  Layers3,
  ListChecks,
  LoaderCircle,
  MousePointer2,
  Network,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  SkipForward,
  Sparkles,
  TerminalSquare,
  TriangleAlert,
  X,
  Zap,
} from 'lucide-react';
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { describeScenarioStep, type Scenario, type ScenarioStep } from '../scenario';
import './studio-next.css';

export type StudioNextPhase = 'loading' | 'ready' | 'error';
export type StudioNextRunStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'finalizing' | 'passed' | 'failed' | 'stopped';
export type StudioNextStepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';
export type StudioNextInspectorTab = 'perception' | 'resolution' | 'evidence';

export const EVIDENCE_ARTIFACT_WARNING = 'Run logs, Playwright traces, and screenshots can contain sensitive page content. Review every artifact before sharing it.';

export interface StudioNextWorkspace {
  id: string;
  name: string;
  path: string;
  branch?: string;
  baseUrl: string;
  configured: boolean;
  connected: boolean;
  sessionLabel: string;
  manifest: {
    filename: string;
    groups: number;
    targets: number;
    coverage: number;
    health: 'healthy' | 'warning' | 'error';
  };
}

export interface StudioNextStep {
  /** Canonical agrune.scenario/v1 step, when this row came from a saved scenario. */
  source?: ScenarioStep;
  id: string;
  kind: 'open' | 'click' | 'fill' | 'press' | 'expect' | 'wait';
  title: string;
  target?: string;
  detail?: string;
  status: StudioNextStepStatus;
  durationMs?: number;
  error?: string;
}

export interface StudioNextScenario {
  /** Canonical agrune.scenario/v1 document. Runtime-only presentation data stays beside it. */
  source?: Scenario;
  id: string;
  title: string;
  intent: string;
  tags: string[];
  readOnly?: boolean;
  sourceLabel?: 'Built in' | 'Workspace';
  updatedLabel: string;
  lastRunStatus: StudioNextRunStatus;
  estimatedMs: number;
  steps: StudioNextStep[];
}

export interface StudioNextGap {
  id: string;
  kind: 'manifest-target' | 'workspace';
  title: string;
  pagePath: string;
  action: string;
  occurrences: number;
  severity: 'warning' | 'error';
  suggestedTarget?: string;
}

export interface StudioNextTimelineEntry {
  id: string;
  timestamp: string;
  kind: 'system' | 'perception' | 'resolution' | 'action' | 'assertion' | 'error';
  title: string;
  detail: string;
  target?: string;
  stepId?: string;
  status: 'pending' | 'success' | 'warning' | 'error';
  durationMs?: number;
}

export interface StudioNextPerception {
  snapshotId: string;
  url: string;
  capturedLabel: string;
  summary: string;
  visibleTargets: string[];
  totalVisibleTargets: number;
  activeTargetRef?: string;
  groups: string[];
  tokenCount: number;
}

export interface StudioNextResolutionCandidate {
  id: string;
  strategy: string;
  query: string;
  outcome: 'matched' | 'missed' | 'ambiguous' | 'pending';
  matchCount?: number;
  durationMs?: number;
}

export interface StudioNextResolution {
  targetId: string;
  action: string;
  outcome: 'resolved' | 'recovered' | 'unresolved' | 'ambiguous' | 'pending';
  policy: string;
  candidates: StudioNextResolutionCandidate[];
}

export interface StudioNextEvidenceItem {
  id: string;
  kind: 'screenshot' | 'trace' | 'run-log' | 'console' | 'network';
  title: string;
  detail: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  action?: 'open' | 'reveal' | 'expand';
  entries?: string[];
}

export interface StudioNextRun {
  id?: string;
  status: StudioNextRunStatus;
  currentStepId?: string;
  elapsedMs: number;
  progress: number;
  startedLabel?: string;
  browserLabel: string;
}

export interface StudioNextViewModel {
  phase: StudioNextPhase;
  errorMessage?: string;
  workspace: StudioNextWorkspace;
  scenarios: StudioNextScenario[];
  gaps: StudioNextGap[];
  selectedScenarioId?: string;
  selectedStepId?: string;
  timeline: StudioNextTimelineEntry[];
  run: StudioNextRun;
  perception?: StudioNextPerception;
  resolution?: StudioNextResolution;
  evidence: StudioNextEvidenceItem[];
  recording?: boolean;
  takeover?: boolean;
  takeoverPending?: boolean;
}

export interface StudioNextActions {
  onRetry?: () => void;
  onOpenWorkspace?: () => void;
  onSelectScenario?: (scenarioId: string) => void;
  onSelectGap?: (gapId: string) => void;
  onSelectStep?: (stepId: string) => void;
  onCreateScenario?: () => void;
  onEditScenario?: (scenarioId: string) => void;
  onRepairReference?: (gapId: string) => void;
  onAddStep?: (scenarioId: string) => void;
  onRecord?: (recording: boolean) => void;
  onRun?: (scenarioId: string) => void;
  onPause?: () => void;
  onResume?: () => void;
  onStep?: (scenarioId: string) => void;
  onStop?: () => void;
  onTakeover?: (takeover: boolean) => void;
  onOpenBrowser?: () => void;
  onOpenManifest?: () => void;
  onOpenEvidence?: (evidenceId: string) => void;
  onHighlightTarget?: (targetRef: string) => void;
  onInspectorTabChange?: (tab: StudioNextInspectorTab) => void;
}

export interface StudioNextProps {
  model?: StudioNextViewModel;
  actions?: StudioNextActions;
  className?: string;
}

export interface StudioNextScenarioRuntime {
  updatedLabel?: string;
  lastRunStatus?: StudioNextRunStatus;
  estimatedMs?: number;
  stepStates?: Record<string, Partial<Pick<StudioNextStep, 'status' | 'durationMs' | 'error'>>>;
  readOnly?: boolean;
  sourceLabel?: 'Built in' | 'Workspace';
}

type LibraryView = 'scenarios' | 'gaps';

const DEMO_MODEL: StudioNextViewModel = {
  phase: 'ready',
  workspace: {
    id: 'agrune-demo',
    name: 'Agrune Demo',
    path: '~/dev/agrune/demo-store',
    branch: 'studio/rethink',
    baseUrl: 'http://localhost:4173',
    configured: true,
    connected: true,
    sessionLabel: 'session 01 · chromium',
    manifest: {
      filename: 'agrune.manifest.yaml',
      groups: 12,
      targets: 148,
      coverage: 86,
      health: 'warning',
    },
  },
  scenarios: [
    {
      id: 'guest-checkout',
      title: 'Guest checkout',
      intent: 'A first-time visitor can buy one item without creating an account.',
      tags: ['critical', 'commerce'],
      updatedLabel: '8 min ago',
      lastRunStatus: 'running',
      estimatedMs: 21_000,
      steps: [
        { id: 'step-open', kind: 'open', title: 'Open cart', detail: '/cart', status: 'passed', durationMs: 641 },
        { id: 'step-email', kind: 'fill', title: 'Enter guest email', target: 'checkout.email', detail: 'fixture: guest.email', status: 'passed', durationMs: 228 },
        { id: 'step-shipping', kind: 'click', title: 'Choose standard shipping', target: 'checkout.shipping.standard', status: 'passed', durationMs: 311 },
        { id: 'step-submit', kind: 'click', title: 'Place the order', target: 'checkout.submit', status: 'running' },
        { id: 'step-response', kind: 'expect', title: 'Order request succeeds', detail: 'POST /api/orders → 201', status: 'queued' },
        { id: 'step-complete', kind: 'expect', title: 'Confirmation is visible', target: 'order.completeHeading', status: 'queued' },
      ],
    },
    {
      id: 'saved-cart',
      title: 'Saved cart restores',
      intent: 'A returning visitor sees the same cart after signing back in.',
      tags: ['regression'],
      updatedLabel: 'Yesterday',
      lastRunStatus: 'passed',
      estimatedMs: 16_500,
      steps: [
        { id: 'saved-open', kind: 'open', title: 'Open sign in', detail: '/login', status: 'passed' },
        { id: 'saved-login', kind: 'click', title: 'Sign in', target: 'auth.submit', status: 'passed' },
        { id: 'saved-cart-count', kind: 'expect', title: 'Saved cart count is restored', target: 'cart.itemCount', status: 'passed' },
      ],
    },
    {
      id: 'refund-order',
      title: 'Refund an order',
      intent: 'Support can refund an eligible captured order from order details.',
      tags: ['admin', 'sensitive'],
      updatedLabel: '2 days ago',
      lastRunStatus: 'failed',
      estimatedMs: 29_000,
      steps: [
        { id: 'refund-open', kind: 'open', title: 'Open order detail', detail: '/admin/orders/1847', status: 'passed' },
        { id: 'refund-menu', kind: 'click', title: 'Open order actions', target: 'orders.actions', status: 'failed', error: 'Target resolved to 0 nodes' },
        { id: 'refund-confirm', kind: 'click', title: 'Confirm refund', target: 'orders.refund.confirm', status: 'queued' },
      ],
    },
  ],
  gaps: [
    {
      id: 'gap-promo',
      kind: 'manifest-target',
      title: 'Promo code toggle',
      pagePath: '/checkout',
      action: 'click',
      occurrences: 3,
      severity: 'warning',
      suggestedTarget: 'checkout.promo.toggle',
    },
    {
      id: 'gap-refund',
      kind: 'manifest-target',
      title: 'Refund menu item',
      pagePath: '/admin/orders/:id',
      action: 'click',
      occurrences: 1,
      severity: 'error',
      suggestedTarget: 'orders.refund.open',
    },
  ],
  selectedScenarioId: 'guest-checkout',
  selectedStepId: 'step-submit',
  run: {
    id: 'run-1847',
    status: 'running',
    currentStepId: 'step-submit',
    elapsedMs: 4_820,
    progress: 54,
    startedLabel: '10:41:23',
    browserLabel: 'Chromium · external window',
  },
  timeline: [
    {
      id: 'event-session',
      timestamp: '10:41:23.018',
      kind: 'system',
      title: 'Run attached to browser session',
      detail: 'Reused workspace session 01 at /cart.',
      status: 'success',
    },
    {
      id: 'event-snapshot',
      timestamp: '10:41:24.102',
      kind: 'perception',
      title: 'Manifest perception refreshed',
      detail: '34 visible targets across checkout and cart groups · 1,284 tokens.',
      status: 'success',
      durationMs: 46,
    },
    {
      id: 'event-email',
      timestamp: '10:41:25.007',
      kind: 'action',
      title: 'Filled guest email',
      detail: 'Value sourced from fixture; plaintext omitted from the run trail.',
      target: 'checkout.email',
      stepId: 'step-email',
      status: 'success',
      durationMs: 228,
    },
    {
      id: 'event-shipping',
      timestamp: '10:41:26.481',
      kind: 'action',
      title: 'Selected standard shipping',
      detail: 'Resolved uniquely through role + accessible name.',
      target: 'checkout.shipping.standard',
      stepId: 'step-shipping',
      status: 'success',
      durationMs: 311,
    },
    {
      id: 'event-resolve',
      timestamp: '10:41:27.809',
      kind: 'resolution',
      title: 'Resolving Place order',
      detail: 'Trying selector ladder rung 2 after the test-id missed.',
      target: 'checkout.submit',
      stepId: 'step-submit',
      status: 'pending',
    },
  ],
  perception: {
    snapshotId: 'snap_01J9R7N0M6',
    url: 'http://localhost:4173/checkout',
    capturedLabel: '46 ms ago',
    summary: 'Checkout form is ready. Guest contact and shipping are complete; payment summary is visible and the order can be submitted.',
    visibleTargets: ['checkout.email', 'checkout.shipping.standard', 'checkout.submit', 'cart.total', 'cart.items'],
    totalVisibleTargets: 5,
    activeTargetRef: 'checkout.submit',
    groups: ['checkout', 'cart'],
    tokenCount: 1284,
  },
  resolution: {
    targetId: 'checkout.submit',
    action: 'click',
    outcome: 'resolved',
    policy: 'Allowed · non-sensitive · unique match required',
    candidates: [
      { id: 'candidate-test-id', strategy: 'test id', query: 'checkout-submit', outcome: 'missed', matchCount: 0, durationMs: 3 },
      { id: 'candidate-role', strategy: 'role + name', query: 'button / Place order', outcome: 'matched', matchCount: 1, durationMs: 8 },
      { id: 'candidate-css', strategy: 'css fallback', query: '[data-action="place-order"]', outcome: 'pending' },
    ],
  },
  evidence: [
    { id: 'evidence-shot', kind: 'screenshot', title: 'Before action', detail: 'checkout-submit-before.png · 1440 × 900' },
    { id: 'evidence-network', kind: 'network', title: '12 network requests', detail: '0 failed · 2 API requests', tone: 'success' },
    { id: 'evidence-console', kind: 'console', title: 'Console is clean', detail: 'No warnings or errors', tone: 'success' },
    { id: 'evidence-trace', kind: 'trace', title: 'Playwright trace', detail: 'Recording while this run is active' },
  ],
  recording: false,
  takeover: false,
};

const stepKindLabels: Record<StudioNextStep['kind'], string> = {
  open: 'NAV',
  click: 'CLICK',
  fill: 'FILL',
  press: 'PRESS',
  expect: 'ASSERT',
  wait: 'WAIT',
};

const runLabels: Record<StudioNextRunStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  paused: 'Paused',
  stopping: 'Stopping',
  finalizing: 'Finalizing',
  passed: 'Passed',
  failed: 'Failed',
  stopped: 'Stopped',
};

/**
 * Adapts the canonical scenario document into the intentionally UI-focused row model.
 * Integrations can keep `Scenario` as their source of truth and supply only ephemeral run metadata.
 */
export function createStudioNextScenario(
  source: Scenario,
  runtime: StudioNextScenarioRuntime = {},
): StudioNextScenario {
  const scenarioId = source.id
    ?? (source.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'scenario');
  const steps = source.steps.map((step, index) => {
    const stepId = step.id ?? `step-${index + 1}`;
    const state = runtime.stepStates?.[stepId];
    return {
      source: step,
      id: stepId,
      kind: scenarioStepKind(step),
      title: step.label ?? scenarioStepTitle(step),
      target: scenarioStepTarget(step),
      detail: scenarioStepDetail(step),
      status: state?.status ?? 'queued',
      ...(state?.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
      ...(state?.error ? { error: state.error } : {}),
    } satisfies StudioNextStep;
  });
  return {
    source,
    id: scenarioId,
    title: source.name,
    intent: source.description ?? 'No scenario intent has been written yet.',
    tags: source.tags ?? [],
    ...(runtime.readOnly !== undefined ? { readOnly: runtime.readOnly } : {}),
    ...(runtime.sourceLabel ? { sourceLabel: runtime.sourceLabel } : {}),
    updatedLabel: runtime.updatedLabel ?? 'Not run',
    lastRunStatus: runtime.lastRunStatus ?? 'idle',
    estimatedMs: runtime.estimatedMs ?? Math.max(3_000, steps.length * 2_000),
    steps,
  };
}

function scenarioStepKind(step: ScenarioStep): StudioNextStep['kind'] {
  if ('assert' in step) return 'expect';
  if (step.do === 'navigate') return 'open';
  if (step.do === 'press') return 'press';
  if (step.do === 'fill' || step.do === 'type' || step.do === 'select') return 'fill';
  if (step.do === 'wait') return 'wait';
  if (step.do === 'waitFor') return 'expect';
  return 'click';
}

function scenarioStepTitle(step: ScenarioStep): string {
  if ('assert' in step) return step.assert.replace(/([A-Z])/g, ' $1').replace(/^./, (value) => value.toUpperCase());
  const titles: Record<string, string> = {
    navigate: 'Open page',
    click: 'Click target',
    dblclick: 'Double-click target',
    contextmenu: 'Open context menu',
    hover: 'Hover target',
    longpress: 'Long-press target',
    fill: 'Fill field',
    type: 'Type text',
    press: 'Press key',
    select: 'Select option',
    check: 'Check target',
    uncheck: 'Uncheck target',
    wait: 'Wait',
    waitFor: 'Wait for target',
  };
  return titles[step.do] ?? step.do;
}

function scenarioStepTarget(step: ScenarioStep): string | undefined {
  if ('ref' in step && typeof step.ref === 'string') return step.ref;
  if ('repeat' in step) return step.repeat;
  return undefined;
}

function scenarioStepDetail(step: ScenarioStep): string | undefined {
  const display = describeScenarioStep(step);
  const target = scenarioStepTarget(step);
  return display.detail === target ? undefined : display.detail;
}

function BrandMark(): JSX.Element {
  return (
    <svg className="next-brand-mark" viewBox="0 0 28 28" aria-hidden="true">
      <path d="M14 2.4 25 8.6v10.8L14 25.6 3 19.4V8.6L14 2.4Z" fill="currentColor" opacity=".16" />
      <path d="m8.3 18.7 5.7-12 5.7 12M10.1 15.2h7.8" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function formatDuration(milliseconds?: number): string {
  if (milliseconds === undefined) return '—';
  if (milliseconds < 1000) return `${milliseconds} ms`;
  return `${(milliseconds / 1000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
}

function shortUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.host}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}

function workspaceInitials(value: string): string {
  const words = value.trim().split(/[^a-z0-9]+/i).filter(Boolean);
  if (!words.length) return 'WS';
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('');
}

function mergeClassNames(...values: Array<string | false | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function moveTabFocus(event: ReactKeyboardEvent<HTMLButtonElement>): void {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const tabs = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []);
  if (!tabs.length) return;
  const current = Math.max(0, tabs.indexOf(event.currentTarget));
  const next = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

export function StudioNext({ model, actions, className }: StudioNextProps): JSX.Element {
  const viewModel = model ?? DEMO_MODEL;
  const isDemo = model === undefined;
  const [libraryView, setLibraryView] = useState<LibraryView>('scenarios');
  const [scenarioFilter, setScenarioFilter] = useState('');
  const [gapFilter, setGapFilter] = useState('');
  const [selectedScenarioId, setSelectedScenarioId] = useState(viewModel.selectedScenarioId ?? viewModel.scenarios[0]?.id);
  const [selectedStepId, setSelectedStepId] = useState(viewModel.selectedStepId);
  const [selectedGapId, setSelectedGapId] = useState<string | undefined>();
  const [inspectorTab, setInspectorTab] = useState<StudioNextInspectorTab>('resolution');
  const [demoRunStatus, setDemoRunStatus] = useState(viewModel.run.status);
  const [demoRecording, setDemoRecording] = useState(Boolean(viewModel.recording));
  const [demoTakeover, setDemoTakeover] = useState(Boolean(viewModel.takeover));

  useEffect(() => {
    if (viewModel.selectedScenarioId) setSelectedScenarioId(viewModel.selectedScenarioId);
  }, [viewModel.selectedScenarioId]);

  useEffect(() => {
    setSelectedStepId(viewModel.selectedStepId);
  }, [viewModel.selectedStepId]);

  useEffect(() => {
    setLibraryView('scenarios');
    setScenarioFilter('');
    setGapFilter('');
    setSelectedGapId(undefined);
    setInspectorTab('resolution');
  }, [viewModel.workspace.id]);

  const selectedScenario = useMemo(
    () => viewModel.scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? viewModel.scenarios[0],
    [selectedScenarioId, viewModel.scenarios],
  );
  const selectedStep = selectedScenario?.steps.find((step) => step.id === selectedStepId)
    ?? selectedScenario?.steps.find((step) => step.id === viewModel.run.currentStepId)
    ?? selectedScenario?.steps[0];
  const selectedGap = viewModel.gaps.find((gap) => gap.id === selectedGapId);
  const runStatus = isDemo ? demoRunStatus : viewModel.run.status;
  const recording = isDemo ? demoRecording : Boolean(viewModel.recording);
  const takeover = isDemo ? demoTakeover : Boolean(viewModel.takeover);
  const takeoverPending = !isDemo && Boolean(viewModel.takeoverPending);
  const runBlockedReason = selectedScenario?.source?.steps.some((step) => 'secretRef' in step)
    ? 'Secret vault execution is not connected. Save is available, but this scenario cannot run yet.'
    : undefined;
  const filter = libraryView === 'scenarios' ? scenarioFilter : gapFilter;
  const setFilter = libraryView === 'scenarios' ? setScenarioFilter : setGapFilter;

  const filteredScenarios = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return viewModel.scenarios;
    return viewModel.scenarios.filter((scenario) =>
      [scenario.title, scenario.intent, ...scenario.tags].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, viewModel.scenarios]);

  const filteredGaps = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return viewModel.gaps;
    return viewModel.gaps.filter((gap) =>
      [gap.title, gap.pagePath, gap.action, gap.suggestedTarget ?? ''].some((value) => value.toLowerCase().includes(query)),
    );
  }, [filter, viewModel.gaps]);
  const timelineTabStopId = useMemo(() => {
    const selectable = viewModel.timeline.filter((entry) => entry.stepId);
    return [...selectable].reverse().find((entry) => entry.stepId === selectedStep?.id)?.id
      ?? selectable.at(-1)?.id;
  }, [selectedStep?.id, viewModel.timeline]);

  if (viewModel.phase === 'loading') {
    return <StudioNextLoading className={className} />;
  }

  if (viewModel.phase === 'error') {
    return (
      <StudioNextFailure
        className={className}
        message={viewModel.errorMessage ?? 'Studio could not attach to the Agrune workspace.'}
        onRetry={actions?.onRetry}
      />
    );
  }

  function chooseScenario(scenarioId: string): void {
    if (isActiveRun) return;
    const scenario = viewModel.scenarios.find((item) => item.id === scenarioId);
    const alreadySelected = scenarioId === selectedScenario?.id;
    if (alreadySelected) {
      if (selectedGapId) setSelectedGapId(undefined);
      return;
    }
    setSelectedScenarioId(scenarioId);
    setSelectedStepId(scenario?.steps[0]?.id);
    setSelectedGapId(undefined);
    if (!alreadySelected) actions?.onSelectScenario?.(scenarioId);
  }

  function chooseGap(gapId: string): void {
    setSelectedGapId(gapId);
    setInspectorTab('resolution');
    actions?.onSelectGap?.(gapId);
    actions?.onInspectorTabChange?.('resolution');
  }

  function chooseStep(stepId: string): void {
    setSelectedStepId(stepId);
    setSelectedGapId(undefined);
    const step = selectedScenario?.steps.find((candidate) => candidate.id === stepId);
    if (step?.target) setInspectorTab('resolution');
    actions?.onSelectStep?.(stepId);
  }

  function chooseInspectorTab(tab: StudioNextInspectorTab): void {
    setInspectorTab(tab);
    actions?.onInspectorTabChange?.(tab);
  }

  function toggleRecording(): void {
    const next = !recording;
    if (isDemo) setDemoRecording(next);
    actions?.onRecord?.(next);
  }

  function startRun(): void {
    if (!selectedScenario || runBlockedReason) return;
    if (isDemo) setDemoRunStatus('running');
    actions?.onRun?.(selectedScenario.id);
  }

  function togglePause(): void {
    if (runStatus === 'paused') {
      if (isDemo) setDemoRunStatus('running');
      actions?.onResume?.();
      return;
    }
    if (isDemo) setDemoRunStatus('paused');
    actions?.onPause?.();
  }

  function stopRun(): void {
    if (isDemo) setDemoRunStatus('stopped');
    actions?.onStop?.();
  }

  function toggleTakeover(): void {
    const next = !takeover;
    if (isDemo) {
      setDemoTakeover(next);
      if (next && runStatus === 'running') setDemoRunStatus('paused');
    }
    actions?.onTakeover?.(next);
  }

  const executingStepIndex = selectedScenario?.steps.findIndex((step) => step.status === 'running') ?? -1;
  const executingStep = executingStepIndex >= 0 ? selectedScenario?.steps[executingStepIndex] : undefined;
  const nextQueuedStepIndex = selectedScenario?.steps.findIndex((step) => step.status === 'queued') ?? -1;
  const nextQueuedStep = nextQueuedStepIndex >= 0 ? selectedScenario?.steps[nextQueuedStepIndex] : undefined;
  const isStepExecuting = Boolean(executingStep);
  const isFinalizing = runStatus === 'finalizing';
  const isActiveRun = runStatus === 'running' || runStatus === 'paused' || runStatus === 'stopping' || isFinalizing;
  const isPreparingStep = runStatus === 'paused'
    && Boolean(viewModel.run.id)
    && !viewModel.run.currentStepId
    && !isStepExecuting;
  const canAdvanceStep = runStatus === 'paused'
    && !isPreparingStep
    && !isStepExecuting
    && Boolean(nextQueuedStep);
  const executingVerb = executingStep?.kind === 'expect' ? 'Checking' : 'Running';
  const nextVerb = nextQueuedStep?.kind === 'expect' ? 'Check' : 'Run';
  const stepActionLabel = isFinalizing || (runStatus === 'paused' && !nextQueuedStep && !isStepExecuting)
    ? 'Finalizing…'
    : isStepExecuting
      ? `${executingVerb} step ${executingStepIndex + 1}…`
      : isPreparingStep
        ? `Preparing step ${nextQueuedStepIndex + 1}…`
        : canAdvanceStep
          ? `${nextVerb} step ${nextQueuedStepIndex + 1}`
          : runStatus === 'running'
            ? 'Run in progress'
            : 'Start step mode';
  const displayedRunLabel = isStepExecuting
    ? `${executingVerb} ${executingStepIndex + 1}/${selectedScenario?.steps.length ?? 0}`
    : runLabels[runStatus];
  const liveRunLabel = isStepExecuting
    ? `${executingVerb.toUpperCase()} ${executingStepIndex + 1}/${selectedScenario?.steps.length ?? 0}`
    : runStatus === 'running'
      ? 'LIVE'
      : runStatus.toUpperCase();
  const stepActionTitle = takeoverPending
    ? 'Wait for manual control handoff to finish'
    : takeover
      ? 'Exit manual control before running a step'
      : isFinalizing
        ? 'Saving screenshots, trace, and the run log before this run finishes'
        : runStatus === 'stopping'
        ? 'Wait for evidence finalization to finish'
        : isStepExecuting
          ? `${executingVerb} step ${executingStepIndex + 1} of ${selectedScenario?.steps.length ?? 0}: ${executingStep?.title ?? 'Current step'}`
          : isPreparingStep
            ? 'The first semantic step is being prepared'
            : canAdvanceStep
              ? `${nextVerb} step ${nextQueuedStepIndex + 1} of ${selectedScenario?.steps.length ?? 0}: ${nextQueuedStep?.title}. Then pause again.`
              : runStatus === 'running'
                ? 'Pause the run before advancing one step'
                : runStatus === 'paused'
                  ? 'All semantic steps are complete; wait for run evidence to finish saving'
                  : 'Start a new run, execute step 1, then pause';
  const displayedResolution = selectedStep?.target && viewModel.resolution?.targetId === selectedStep.target
    ? viewModel.resolution
    : undefined;
  const shellClassName = mergeClassNames('next-studio', className);

  return (
    <div className={shellClassName}>
      <header className="next-titlebar">
        <div className="next-title-brand next-no-drag">
          <BrandMark />
          <span>Agrune</span>
          <span className="next-product-name">Studio</span>
          <span className="next-version-pill">NEXT</span>
        </div>
        <div className="next-title-context">
          <span>{viewModel.workspace.name}</span>
          <ChevronRight size={12} />
          <span>{selectedScenario?.title ?? 'Scenario workbench'}</span>
        </div>
        <div className="next-title-session next-no-drag">
          <span className={mergeClassNames('next-engine-dot', viewModel.workspace.connected && 'connected')} />
          <span>{viewModel.workspace.connected ? viewModel.workspace.sessionLabel : 'Browser offline'}</span>
          <button
            type="button"
            className="next-title-link"
            disabled={!actions?.onOpenBrowser}
            onClick={actions?.onOpenBrowser}
            title={!viewModel.workspace.connected ? 'Start the controlled browser' : isActiveRun ? 'View the controlled browser. The current run continues.' : 'View the controlled browser'}
          >
            <ExternalLink size={12} /> {viewModel.workspace.connected ? 'View browser' : 'Start browser'}
          </button>
        </div>
      </header>

      <div className="next-layout">
        <aside className="next-library">
          <section className="next-workspace-card">
            <span className="next-eyebrow">Workspace</span>
            <div className="next-workspace-title">
              <div className="next-workspace-avatar">{workspaceInitials(viewModel.workspace.name)}</div>
              <div>
                <strong>{viewModel.workspace.name}</strong>
                <span>{viewModel.workspace.branch ?? viewModel.workspace.path}</span>
              </div>
              {selectedScenario && <button type="button" className="next-icon-button" aria-label="Switch workspace" title={isActiveRun ? 'Stop the current run before switching workspaces' : 'Switch workspace'} disabled={isActiveRun || !actions?.onOpenWorkspace} onClick={actions?.onOpenWorkspace}><Layers3 size={14} /></button>}
            </div>
            <div className="next-workspace-endpoint">
              <span className={mergeClassNames('next-status-dot', viewModel.workspace.connected && 'connected')} />
              <code>{shortUrl(viewModel.workspace.baseUrl)}</code>
              <span
                className={mergeClassNames('next-evidence-state', viewModel.workspace.configured ? 'on' : 'off')}
                title={viewModel.workspace.configured ? 'Screenshots, Playwright traces, and run logs are saved' : 'Configure this workspace to save screenshots, Playwright traces, and run logs'}
              >
                Run files {viewModel.workspace.configured ? 'on' : 'off'}
              </span>
            </div>
          </section>

          <section className="next-library-content">
            <div className="next-library-tabs" role="tablist" aria-label="Library view">
              <button
                type="button"
                role="tab"
                aria-selected={libraryView === 'scenarios'}
                aria-controls="studio-library-panel"
                tabIndex={libraryView === 'scenarios' ? 0 : -1}
                className={libraryView === 'scenarios' ? 'active' : ''}
                onKeyDown={moveTabFocus}
                onClick={() => {
                  setLibraryView('scenarios');
                  setSelectedGapId(undefined);
                }}
              >
                <ListChecks size={13} /> Scenarios <span>{viewModel.scenarios.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={libraryView === 'gaps'}
                aria-controls="studio-library-panel"
                tabIndex={libraryView === 'gaps' ? 0 : -1}
                className={libraryView === 'gaps' ? 'active' : ''}
                onKeyDown={moveTabFocus}
                onClick={() => setLibraryView('gaps')}
              >
                <AlertCircle size={13} /> Issues <span>{viewModel.gaps.length}</span>
              </button>
            </div>

            <label className="next-search-field">
              <Search size={13} />
              <input
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
                placeholder={libraryView === 'scenarios' ? 'Filter scenarios' : 'Filter issues'}
                aria-label={libraryView === 'scenarios' ? 'Filter scenarios' : 'Filter issues'}
              />
              {filter && <button type="button" aria-label="Clear filter" onClick={() => setFilter('')}><X size={11} /></button>}
            </label>

            <div id="studio-library-panel" className="next-library-scroll" role="tabpanel" aria-label={libraryView === 'scenarios' ? 'Scenarios' : 'Issues'}>
              {libraryView === 'scenarios' ? (
                filteredScenarios.length ? filteredScenarios.map((scenario, index) => (
                  <ScenarioListItem
                    key={scenario.id}
                    index={viewModel.scenarios.indexOf(scenario) >= 0 ? viewModel.scenarios.indexOf(scenario) : index}
                    scenario={scenario}
                    selected={scenario.id === selectedScenario?.id && !selectedGap}
                    disabled={isActiveRun}
                    onClick={() => chooseScenario(scenario.id)}
                  />
                )) : <LibraryEmpty label="No matching scenarios" />
              ) : (
                filteredGaps.length ? filteredGaps.map((gap) => (
                  <GapListItem key={gap.id} gap={gap} selected={gap.id === selectedGap?.id} onClick={() => chooseGap(gap.id)} />
                )) : <LibraryEmpty label={gapFilter ? 'No matching issues' : 'No issues'} />
              )}
            </div>

            {selectedScenario && (
              <button type="button" className="next-create-button" disabled={isActiveRun || !actions?.onCreateScenario} title={isActiveRun ? 'Stop the current run before editing scenarios' : undefined} onClick={actions?.onCreateScenario}>
                <Plus size={14} /> New scenario
              </button>
            )}
          </section>

          <div className="next-manifest-footer" aria-label="Runtime manifest status">
            <div
              className="next-coverage-ring"
              style={{ '--next-coverage': `${viewModel.workspace.manifest.coverage}%` } as CSSProperties}
            >
              <Braces size={14} />
            </div>
            <div>
              <strong>{viewModel.workspace.manifest.filename}</strong>
              <span>{viewModel.workspace.manifest.groups} groups · {viewModel.workspace.manifest.targets} targets · {viewModel.workspace.manifest.coverage}% resolved</span>
            </div>
            <button
              type="button"
              className="next-manifest-refresh"
              aria-label="Refresh runtime manifest"
              title={viewModel.workspace.connected ? 'Refresh runtime manifest' : 'Start the controlled browser before refreshing the manifest'}
              disabled={!viewModel.workspace.connected || !actions?.onOpenManifest}
              onClick={actions?.onOpenManifest}
            ><RefreshCw size={15} /> Refresh</button>
          </div>
        </aside>

        <main className="next-workbench">
          {selectedScenario ? (
            <>
              <header className="next-workbench-header">
                <div className="next-scenario-heading">
                  <div className="next-scenario-icon"><Zap size={16} /></div>
                  <div>
                    <div className="next-heading-line">
                      <h1>{selectedScenario.title}</h1>
                      {selectedScenario.tags.map((tag) => <span className="next-tag" key={tag}>{tag}</span>)}
                    </div>
                    <p>{selectedScenario.intent}</p>
                  </div>
                </div>
                <div className="next-header-meta">
                  <span className={mergeClassNames('next-run-chip', runStatus, isStepExecuting && 'executing')} role="status" aria-live="polite" aria-atomic="true"><span />{displayedRunLabel}</span>
                  {isActiveRun && <span className="next-run-lock-copy">Run locked · stop to switch or edit</span>}
                  {!isActiveRun && runBlockedReason && <span className="next-run-lock-copy" title={runBlockedReason}>Secret vault required</span>}
                  <button
                    type="button"
                    className="next-edit-button"
                    aria-label={selectedScenario.readOnly ? 'Copy built-in scenario to workspace and edit' : 'Edit scenario'}
                    disabled={isActiveRun || !actions?.onEditScenario}
                    title={isActiveRun ? 'Stop the current run before editing scenarios' : undefined}
                    onClick={() => actions?.onEditScenario?.(selectedScenario.id)}
                  ><Code2 size={13} /> {selectedScenario.readOnly ? 'Create editable copy' : 'Edit'}</button>
                </div>
              </header>

              {selectedGap && (
                <div className={mergeClassNames('next-gap-banner', selectedGap.severity)}>
                  <TriangleAlert size={15} />
                  <div>
                    <strong>{selectedGap.kind === 'manifest-target' ? 'Unmapped action selected' : 'Workspace issue selected'}</strong>
                    {selectedGap.kind === 'manifest-target'
                      ? <span>{selectedGap.action} on {selectedGap.pagePath} · failed ref <code>{selectedGap.suggestedTarget}</code></span>
                      : <span>{selectedGap.action} at <code>{selectedGap.pagePath}</code></span>}
                  </div>
                </div>
              )}

              {runStatus === 'failed' && !selectedGap && (
                <div className="next-failure-banner">
                  <TriangleAlert size={15} />
                  <div><strong>Run stopped at the first failure.</strong><span>{viewModel.resolution?.outcome === 'unresolved' || viewModel.resolution?.outcome === 'ambiguous' ? 'Inspect the evidence, repair the unresolved scenario reference, then run again.' : 'Inspect the failed step and its evidence, correct the cause, then run again.'}</span></div>
                  <button type="button" onClick={() => chooseInspectorTab('evidence')}>View evidence</button>
                </div>
              )}

              <div className="next-workbench-grid">
                <section className="next-panel next-steps-panel">
                  <PanelHeading
                    eyebrow="Scenario"
                    title="Semantic steps"
                    trailing={<span>{selectedScenario.steps.length} steps · ~{Math.ceil(selectedScenario.estimatedMs / 1000)}s</span>}
                  />
                  <div className="next-steps-list">
                    {selectedScenario.steps.map((step, index) => (
                      <ScenarioStepRow
                        key={step.id}
                        step={step}
                        index={index}
                        selected={step.id === selectedStep?.id}
                        active={step.id === viewModel.run.currentStepId && step.status === 'running'}
                        upcoming={runStatus === 'paused' && !isStepExecuting && step.id === nextQueuedStep?.id}
                        onClick={() => chooseStep(step.id)}
                      />
                    ))}
                    <button type="button" className="next-add-step" disabled={isActiveRun || !actions?.onAddStep} title={isActiveRun ? 'Stop the current run before editing scenarios' : undefined} onClick={() => actions?.onAddStep?.(selectedScenario.id)}>
                      <Plus size={13} /> {selectedScenario.readOnly ? 'Copy with new step' : 'Add semantic step'}
                    </button>
                  </div>
                </section>

                <section className="next-panel next-timeline-panel">
                  <PanelHeading
                    eyebrow="Live run"
                    title="Agent timeline"
                    trailing={<span className="next-live-label"><i className={mergeClassNames(runStatus, isStepExecuting && 'executing')} />{liveRunLabel}</span>}
                  />
                  <div className="next-timeline-list">
                    {viewModel.timeline.length ? viewModel.timeline.map((entry, index) => (
                      <TimelineRow
                        key={entry.id}
                        entry={entry}
                        last={index === viewModel.timeline.length - 1}
                        selected={Boolean(entry.stepId && entry.stepId === selectedStep?.id)}
                        tabStop={entry.id === timelineTabStopId}
                        onClick={entry.stepId ? () => chooseStep(entry.stepId!) : undefined}
                      />
                    )) : (
                      <TimelineEmpty />
                    )}
                    {(runStatus === 'running' || runStatus === 'stopping' || isFinalizing || isStepExecuting) && (
                      <div className="next-timeline-waiting" role="status" aria-live="polite"><LoaderCircle size={13} /> {
                        isFinalizing
                          ? 'Saving screenshots, Playwright trace, and run log…'
                          : runStatus === 'stopping'
                            ? 'Stopping after the current browser action…'
                            : isStepExecuting
                              ? `${executingVerb} step ${executingStepIndex + 1} of ${selectedScenario.steps.length} · ${executingStep?.title}`
                              : 'Waiting for the browser action to settle…'
                      }</div>
                    )}
                  </div>
                </section>
              </div>

              <footer className="next-command-dock">
                {actions?.onRecord && (
                  <button
                    type="button"
                    className={mergeClassNames('next-record-button', recording && 'active')}
                    aria-pressed={recording}
                    onClick={toggleRecording}
                  >
                    <span /> {recording ? 'Recording' : 'Record'}
                  </button>
                )}
                <div className="next-run-progress">
                  <div>
                    <span>{viewModel.run.id ?? 'No active run'}</span>
                    {viewModel.run.id && <span>{formatDuration(viewModel.run.elapsedMs)}</span>}
                  </div>
                  <div className={mergeClassNames('next-progress-track', runStatus)} role="progressbar" aria-label="Run progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={viewModel.run.progress}><span style={{ width: `${viewModel.run.progress}%` }} /></div>
                </div>
                <div className="next-run-actions">
                  {!isActiveRun && (
                    <button type="button" className="next-primary-action" disabled={takeover || takeoverPending || Boolean(runBlockedReason) || (!isDemo && !actions?.onRun)} title={takeoverPending ? 'Wait for manual control handoff to finish' : takeover ? 'Exit manual control before starting a run' : runBlockedReason} onClick={startRun}><Play size={14} fill="currentColor" /> Run</button>
                  )}
                  {isActiveRun && (
                    <button type="button" className="next-pause-action" disabled={runStatus === 'stopping' || isFinalizing || (runStatus === 'paused' && (isStepExecuting || isPreparingStep)) || takeover || takeoverPending || (!isDemo && !(runStatus === 'paused' ? actions?.onResume : actions?.onPause))} title={takeoverPending ? 'Manual control handoff is waiting for the current step' : takeover ? 'Exit manual control before resuming the run' : runStatus === 'paused' && isPreparingStep ? 'Wait for the first semantic step to start and finish before resuming continuous execution' : runStatus === 'paused' && isStepExecuting ? 'Wait for the current semantic step to finish before resuming continuous execution' : runStatus === 'paused' ? 'Resume the paused run' : isFinalizing ? 'Run evidence is being saved' : runStatus === 'stopping' ? 'The run is already stopping' : 'Pause after the current semantic step'} onClick={togglePause}>
                      {runStatus === 'paused' ? <Play size={14} /> : runStatus === 'stopping' || isFinalizing ? <LoaderCircle size={14} className="next-spin" /> : <Pause size={14} />}
                      {runStatus === 'paused' ? 'Resume' : isFinalizing ? 'Finalizing…' : runStatus === 'stopping' ? 'Stopping…' : 'Pause after step'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="next-secondary-action"
                    disabled={runStatus === 'running' || runStatus === 'stopping' || isFinalizing || isStepExecuting || isPreparingStep || (runStatus === 'paused' && !canAdvanceStep) || takeover || takeoverPending || Boolean(runBlockedReason) || !selectedScenario || (!isDemo && !actions?.onStep)}
                    title={runBlockedReason ?? stepActionTitle}
                    onClick={() => selectedScenario && actions?.onStep?.(selectedScenario.id)}
                  ><SkipForward size={14} /> {stepActionLabel}</button>
                  <button type="button" className="next-stop-action" disabled={!isActiveRun || runStatus === 'stopping' || isFinalizing || (!isDemo && !actions?.onStop)} title={!isActiveRun ? 'No run is active' : isFinalizing ? 'Run evidence is already being finalized' : runStatus === 'stopping' ? 'The run is already stopping' : 'Stop after the current browser action'} onClick={stopRun} aria-label="Stop run"><CircleStop size={16} /> Stop</button>
                  <span className="next-dock-divider" />
                  <button type="button" className={mergeClassNames('next-takeover-action', takeover && 'active')} disabled={runStatus === 'stopping' || isFinalizing || takeoverPending || (!takeover && !viewModel.workspace.connected) || (!isDemo && !actions?.onTakeover)} title={takeoverPending ? 'Waiting for the current semantic step to finish' : isFinalizing ? 'Wait for run evidence to finish saving' : takeover ? 'Exit manual control; a paused run stays paused' : !viewModel.workspace.connected ? 'Start the controlled browser first' : runStatus === 'running' ? 'Pause after the current step and take manual control' : runStatus === 'paused' ? 'Take manual control while the run stays paused' : 'Take manual control of the browser'} onClick={toggleTakeover}>
                    <Hand size={14} /> {takeoverPending ? 'Waiting for step…' : takeover ? 'Exit manual control' : runStatus === 'running' ? 'Pause & take over' : 'Take over'}
                  </button>
                </div>
              </footer>
            </>
          ) : (
            <WorkbenchEmpty onCreate={actions?.onCreateScenario} onOpen={actions?.onOpenWorkspace} />
          )}
        </main>

        <aside className="next-inspector">
          <header className="next-inspector-header">
            <div><span className="next-eyebrow">Inspector</span><h2>{selectedGap ? selectedGap.kind === 'workspace' ? 'Workspace issue' : 'Manifest gap' : selectedStep?.title ?? 'Run context'}</h2></div>
            {!selectedGap && selectedStep?.target && (
              <div className="next-inspector-target">
                <code>{selectedStep.target}</code>
                <button
                  type="button"
                  disabled={isActiveRun || !actions?.onHighlightTarget}
                  title={isActiveRun ? 'Stop the current run before highlighting another target' : 'Resolve and highlight this target in the controlled browser'}
                  onClick={() => actions?.onHighlightTarget?.(selectedStep.target!)}
                ><Eye size={11} /> Highlight in browser</button>
              </div>
            )}
            {selectedGap?.suggestedTarget && <code>{selectedGap.suggestedTarget}</code>}
          </header>

          <div className="next-inspector-tabs" role="tablist" aria-label="Inspector detail">
            <InspectorTabButton icon={<Eye size={13} />} label="Perception" selected={inspectorTab === 'perception'} onClick={() => chooseInspectorTab('perception')} />
            <InspectorTabButton icon={<Braces size={13} />} label="Resolution" selected={inspectorTab === 'resolution'} onClick={() => chooseInspectorTab('resolution')} />
            <InspectorTabButton icon={<Activity size={13} />} label="Evidence" selected={inspectorTab === 'evidence'} onClick={() => chooseInspectorTab('evidence')} />
          </div>

          <div id="studio-inspector-panel" className="next-inspector-scroll" role="tabpanel" aria-label={`${inspectorTab} inspector`}>
            {inspectorTab === 'perception' && <PerceptionPane perception={viewModel.perception} />}
            {inspectorTab === 'resolution' && (
              <ResolutionPane
                resolution={displayedResolution}
                gap={selectedGap}
                selectedTargetRef={selectedStep?.target}
                browserConnected={viewModel.workspace.connected}
                repairDisabled={isActiveRun}
                onRepairReference={selectedGap?.kind === 'manifest-target' && actions?.onRepairReference ? () => actions.onRepairReference!(selectedGap.id) : undefined}
              />
            )}
            {inspectorTab === 'evidence' && <EvidencePane key={viewModel.workspace.id} evidence={viewModel.evidence} onOpen={actions?.onOpenEvidence} />}
          </div>

          <footer className="next-inspector-footer">
            <span><Bot size={13} /> Agent sees manifest refs, not raw DOM</span>
            <span>{viewModel.workspace.manifest.targets} targets</span>
          </footer>
        </aside>
      </div>
    </div>
  );
}

function ScenarioListItem({
  scenario,
  index,
  selected,
  disabled,
  onClick,
}: {
  scenario: StudioNextScenario;
  index: number;
  selected: boolean;
  disabled?: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button type="button" aria-current={selected ? 'true' : undefined} aria-label={`${scenario.title}. ${scenario.sourceLabel ?? 'Scenario'}. Last run: ${scenario.lastRunStatus === 'idle' ? 'Never run' : runLabels[scenario.lastRunStatus]}.`} className={mergeClassNames('next-scenario-item', selected && 'selected')} disabled={disabled} title={disabled ? 'The active run is locked to its scenario' : undefined} onClick={onClick}>
      <div className="next-scenario-item-top">
        <span>{String(index + 1).padStart(2, '0')}</span>
        <RunStateGlyph status={scenario.lastRunStatus} />
      </div>
      <strong>{scenario.title}{scenario.sourceLabel && <small>{scenario.sourceLabel}</small>}</strong>
      <p>{scenario.intent}</p>
      <div className="next-scenario-item-meta">
        <span><ListChecks size={10} />{scenario.steps.length}</span>
        <span><Clock3 size={10} />~{Math.ceil(scenario.estimatedMs / 1000)}s</span>
        <span>{scenario.updatedLabel}</span>
      </div>
    </button>
  );
}

function GapListItem({ gap, selected, onClick }: { gap: StudioNextGap; selected: boolean; onClick: () => void }): JSX.Element {
  return (
    <button type="button" aria-pressed={selected} className={mergeClassNames('next-gap-item', gap.severity, selected && 'selected')} onClick={onClick}>
      <span className="next-gap-glyph"><TriangleAlert size={13} /></span>
      <div>
        <strong>{gap.title}</strong>
        <code>{gap.pagePath}</code>
        <span>{gap.action} · seen {gap.occurrences}×</span>
      </div>
      <ChevronRight size={13} />
    </button>
  );
}

function RunStateGlyph({ status }: { status: StudioNextRunStatus }): JSX.Element {
  if (status === 'passed') return <span className="next-list-state passed"><Check size={10} /></span>;
  if (status === 'failed') return <span className="next-list-state failed"><X size={10} /></span>;
  if (status === 'running' || status === 'stopping' || status === 'finalizing') return <span className="next-list-state running"><i /></span>;
  return <span className="next-list-state"><i /></span>;
}

function LibraryEmpty({ label }: { label: string }): JSX.Element {
  return <div className="next-library-empty"><Search size={17} /><span>{label}</span></div>;
}

function PanelHeading({ eyebrow, title, trailing }: { eyebrow: string; title: string; trailing?: ReactNode }): JSX.Element {
  return (
    <header className="next-panel-heading">
      <div><span className="next-eyebrow">{eyebrow}</span><h2>{title}</h2></div>
      <div className="next-panel-trailing">{trailing}</div>
    </header>
  );
}

function ScenarioStepRow({
  step,
  index,
  selected,
  active,
  upcoming,
  onClick,
}: {
  step: StudioNextStep;
  index: number;
  selected: boolean;
  active: boolean;
  upcoming: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={mergeClassNames('next-step-row', step.status, selected && 'selected', active && 'active', upcoming && 'upcoming')}
      onClick={onClick}
    >
      <span className="next-step-index">{String(index + 1).padStart(2, '0')}</span>
      <span className="next-step-icon"><StepStatusIcon status={step.status} /></span>
      <span className="next-step-copy">
        <span><b>{stepKindLabels[step.kind]}</b>{active && <em>{step.kind === 'expect' ? 'CHECKING' : 'RUNNING'}</em>}{upcoming && <em>NEXT</em>}</span>
        <strong>{step.title}</strong>
        <code>{step.target ?? step.detail ?? 'No target required'}</code>
        {step.error && <small>{step.error}</small>}
      </span>
      <span className="next-step-duration">{formatDuration(step.durationMs)}</span>
      <ChevronRight size={13} className="next-step-chevron" />
    </button>
  );
}

function StepStatusIcon({ status }: { status: StudioNextStepStatus }): JSX.Element {
  if (status === 'passed') return <Check size={12} />;
  if (status === 'failed') return <X size={12} />;
  if (status === 'running') return <LoaderCircle size={12} className="next-spin" />;
  if (status === 'skipped') return <SkipForward size={11} />;
  return <span />;
}

function TimelineRow({
  entry,
  last,
  selected,
  tabStop,
  onClick,
}: {
  entry: StudioNextTimelineEntry;
  last: boolean;
  selected: boolean;
  tabStop: boolean;
  onClick?: () => void;
}): JSX.Element {
  const content = (
    <>
      <div className="next-timeline-time">{entry.timestamp}</div>
      <div className="next-timeline-rail">
        <span className={mergeClassNames('next-timeline-node', entry.kind, entry.status)}>{timelineIcon(entry.kind)}</span>
        {!last && <i />}
      </div>
      <div className="next-timeline-copy">
        <div><span>{entry.kind}</span>{entry.durationMs !== undefined && <time>{formatDuration(entry.durationMs)}</time>}</div>
        <strong>{entry.title}</strong>
        <p>{entry.detail}</p>
        {entry.target && <code>{entry.target}</code>}
      </div>
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        aria-pressed={selected}
        className={mergeClassNames('next-timeline-row', selected && 'selected')}
        tabIndex={tabStop ? 0 : -1}
        onKeyDown={(event) => {
          if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          const rows = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('button.next-timeline-row') ?? []);
          if (!rows.length) return;
          const current = Math.max(0, rows.indexOf(event.currentTarget));
          const next = event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? rows.length - 1
              : (current + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
          event.preventDefault();
          rows[next]?.focus();
          rows[next]?.click();
        }}
        onClick={onClick}
      >{content}</button>
    );
  }
  return <div className={mergeClassNames('next-timeline-row', selected && 'selected')}>{content}</div>;
}

function timelineIcon(kind: StudioNextTimelineEntry['kind']): JSX.Element {
  if (kind === 'perception') return <Eye size={11} />;
  if (kind === 'resolution') return <Braces size={11} />;
  if (kind === 'action') return <MousePointer2 size={11} />;
  if (kind === 'assertion') return <Check size={11} />;
  if (kind === 'error') return <TriangleAlert size={11} />;
  return <Zap size={11} />;
}

function TimelineEmpty(): JSX.Element {
  return (
    <div className="next-timeline-empty">
      <div><Activity size={20} /></div>
      <strong>No run events yet</strong>
      <p>Start this scenario to capture perception, target resolution, actions, and assertions in one trail.</p>
    </div>
  );
}

function InspectorTabButton({
  icon,
  label,
  selected,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  selected: boolean;
  onClick: () => void;
}): JSX.Element {
  return <button type="button" role="tab" aria-selected={selected} aria-controls="studio-inspector-panel" tabIndex={selected ? 0 : -1} className={selected ? 'active' : ''} onKeyDown={moveTabFocus} onClick={onClick}>{icon}{label}</button>;
}

function PerceptionPane({ perception }: { perception?: StudioNextPerception }): JSX.Element {
  if (!perception) return <InspectorEmpty icon={<Eye size={19} />} title="No perception snapshot" copy="A snapshot appears after Agrune observes the active page." />;
  return (
    <div className="next-inspector-pane">
      <section className="next-context-card">
        <div className="next-context-card-heading">
          <span className="next-context-icon"><Bot size={15} /></span>
          <div><span className="next-eyebrow">Agent perception</span><strong>What the agent received</strong></div>
          <span className="next-freshness">{perception.capturedLabel}</span>
        </div>
        <p>{perception.summary}</p>
      </section>
      <InspectorSection title="Snapshot">
        <DefinitionRows rows={[
          ['ID', perception.snapshotId],
          ['Page', shortUrl(perception.url)],
          ['Estimated payload', `${perception.tokenCount.toLocaleString()} tokens (approx.)`],
          ['Groups', perception.groups.join(', ')],
        ]} />
      </InspectorSection>
      <InspectorSection title={`Visible targets · ${perception.visibleTargets.length} of ${perception.totalVisibleTargets}`}>
        <div className="next-target-list">
          {perception.visibleTargets.map((target, index) => (
            <div key={target} className={target === perception.activeTargetRef ? 'active' : ''}><span>{String(index + 1).padStart(2, '0')}</span><code>{target}</code>{target === perception.activeTargetRef && <Eye size={11} />}</div>
          ))}
        </div>
      </InspectorSection>
      <div className="next-info-note"><Sparkles size={13} /><span>This compact manifest view is the agent's source of truth for the current page.</span></div>
    </div>
  );
}

function ResolutionPane({
  resolution,
  gap,
  selectedTargetRef,
  browserConnected,
  repairDisabled,
  onRepairReference,
}: {
  resolution?: StudioNextResolution;
  gap?: StudioNextGap;
  selectedTargetRef?: string;
  browserConnected?: boolean;
  repairDisabled?: boolean;
  onRepairReference?: () => void;
}): JSX.Element {
  if (gap) {
    if (gap.kind === 'workspace') {
      return (
        <div className="next-inspector-pane">
          <section className="next-context-card warning">
            <div className="next-context-card-heading">
              <span className="next-context-icon"><TriangleAlert size={15} /></span>
              <div><span className="next-eyebrow">Workspace issue</span><strong>{gap.title}</strong></div>
            </div>
            <p>Studio could not validate part of this workspace. Fix the referenced file, then reopen the workspace.</p>
          </section>
          <InspectorSection title="Issue details">
            <DefinitionRows rows={[
              ['Location', gap.pagePath],
              ['Category', gap.action],
              ['Occurrences', String(gap.occurrences)],
            ]} />
          </InspectorSection>
        </div>
      );
    }
    return (
      <div className="next-inspector-pane">
        <section className="next-context-card warning">
          <div className="next-context-card-heading">
            <span className="next-context-icon"><TriangleAlert size={15} /></span>
            <div><span className="next-eyebrow">Manifest gap</span><strong>{gap.title}</strong></div>
          </div>
          <p>This browser action could not be mapped to a stable manifest target.</p>
        </section>
        <InspectorSection title="Observed action">
          <DefinitionRows rows={[
            ['Page', gap.pagePath],
            ['Action', gap.action],
            ['Occurrences', String(gap.occurrences)],
            ['Failed reference', gap.suggestedTarget ?? '—'],
          ]} />
        </InspectorSection>
        <div className="next-gap-target-preview">
          <span className="next-eyebrow">Failed reference</span>
          <code>{gap.suggestedTarget ?? 'group.target'}</code>
          <p>This reference did not resolve. Manifest authoring is not available in Studio yet; update the scenario step in the editor.</p>
          <button
            type="button"
            disabled={repairDisabled || !onRepairReference}
            title={repairDisabled ? 'Stop the current run before editing the scenario reference' : !onRepairReference ? 'Scenario reference editing is unavailable' : undefined}
            onClick={onRepairReference}
          ><Code2 size={13} /> Edit scenario reference</button>
        </div>
      </div>
    );
  }
  if (!resolution && selectedTargetRef) {
    return <InspectorEmpty icon={<Braces size={19} />} title="Not resolved yet" copy={browserConnected ? 'Run the scenario or highlight this target to inspect its selector ladder.' : 'Start the browser, then highlight this target to inspect its selector ladder.'} />;
  }
  if (!resolution) return <InspectorEmpty icon={<Braces size={19} />} title="No target selected" copy="Select a target-backed step to inspect its selector ladder." />;
  return (
    <div className="next-inspector-pane">
      <section className="next-resolution-hero">
        <div><span className={mergeClassNames('next-resolution-dot', resolution.outcome)} /><span>{resolution.outcome}</span></div>
        <code>{resolution.targetId}</code>
        <p>{resolution.action} · {resolution.policy}</p>
      </section>
      <InspectorSection title="Selector ladder">
        <div className="next-resolution-ladder">
          {resolution.candidates.map((candidate, index) => (
            <div className={mergeClassNames('next-candidate-row', candidate.outcome)} key={candidate.id}>
              <div className="next-candidate-order">
                <span>{index + 1}</span>
                {index < resolution.candidates.length - 1 && <i />}
              </div>
              <div className="next-candidate-copy">
                <div>
                  <strong>{candidate.strategy}</strong>
                  <span>{candidate.durationMs !== undefined
                    ? formatDuration(candidate.durationMs)
                    : candidate.outcome === 'matched'
                      ? 'recovered'
                      : 'not tried'}</span>
                </div>
                <code>{candidate.query}</code>
              </div>
              <div className="next-candidate-result">
                {candidate.outcome === 'matched' ? <Check size={12} /> : candidate.outcome === 'missed' ? <X size={12} /> : <span />}
                <small>{candidate.matchCount !== undefined ? `${candidate.matchCount} match` : candidate.outcome}</small>
              </div>
            </div>
          ))}
        </div>
      </InspectorSection>
      <InspectorSection title="Contract">
        <DefinitionRows rows={[
          ['Action', resolution.action],
          ['Cardinality', 'exactly one'],
          ['Sensitive', 'no'],
          ['Winning rung', resolution.candidates.findIndex((candidate) => candidate.outcome === 'matched') >= 0
            ? `#${resolution.candidates.findIndex((candidate) => candidate.outcome === 'matched') + 1}`
            : '—'],
        ]} />
      </InspectorSection>
    </div>
  );
}

function EvidencePane({ evidence, onOpen }: { evidence: StudioNextEvidenceItem[]; onOpen?: (id: string) => void }): JSX.Element {
  const [expandedId, setExpandedId] = useState<string>();
  if (!evidence.length) return <InspectorEmpty icon={<Activity size={19} />} title="No evidence captured" copy="Screenshots, trace, console, and network evidence appear during a run." />;
  const screenshot = evidence.find((item) => item.kind === 'screenshot');
  const otherEvidence = evidence.filter((item) => item.kind !== 'screenshot');
  function activate(item: StudioNextEvidenceItem): void {
    if (item.action === 'expand') {
      setExpandedId((current) => current === item.id ? undefined : item.id);
      return;
    }
    onOpen?.(item.id);
  }
  return (
    <div className="next-inspector-pane">
      {screenshot && (
        <button type="button" className="next-screenshot-artifact" title="Open screenshot" disabled={!onOpen} onClick={() => activate(screenshot)}>
          <div className="next-screenshot-canvas">
            <span /><span /><span />
            <div><i /><i /><i /></div>
            <b>ARTIFACT</b>
          </div>
          <div><span><Eye size={12} /> {screenshot.title}</span><small>{screenshot.detail}</small></div>
          <ExternalLink size={13} />
        </button>
      )}
      <InspectorSection title="Run evidence">
        <div className="next-evidence-list">
          {otherEvidence.map((item) => (
            <div className="next-evidence-entry" key={item.id}>
              <button
                type="button"
                className={mergeClassNames('next-evidence-row', item.tone)}
                aria-expanded={item.action === 'expand' ? expandedId === item.id : undefined}
                disabled={item.action !== 'expand' && !onOpen}
                title={item.action === 'reveal' ? 'Reveal file in Finder' : item.action === 'open' ? 'Open file' : expandedId === item.id ? 'Hide captured details' : 'Show captured details'}
                onClick={() => activate(item)}
              >
                <span className="next-evidence-icon">{evidenceIcon(item.kind)}</span>
                <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                {item.action === 'open' || item.action === 'reveal' ? <ExternalLink size={13} /> : <ChevronRight size={13} className={expandedId === item.id ? 'expanded' : ''} />}
              </button>
              {item.action === 'expand' && expandedId === item.id && (
                <div className="next-evidence-details" role="region" aria-label={`${item.title} details`}>
                  {item.entries?.length
                    ? item.entries.map((entry, index) => <code key={`${item.id}-${index}`}>{entry}</code>)
                    : <p>No entries were captured for this run.</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      </InspectorSection>
      <div className="next-info-note warning"><TriangleAlert size={13} /><span>{EVIDENCE_ARTIFACT_WARNING}</span></div>
    </div>
  );
}

function evidenceIcon(kind: StudioNextEvidenceItem['kind']): JSX.Element {
  if (kind === 'trace') return <Activity size={13} />;
  if (kind === 'run-log') return <FileCode2 size={13} />;
  if (kind === 'console') return <TerminalSquare size={13} />;
  if (kind === 'network') return <Network size={13} />;
  return <Eye size={13} />;
}

function InspectorSection({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return <section className="next-inspector-section"><h3>{title}</h3>{children}</section>;
}

function DefinitionRows({ rows }: { rows: Array<[string, string]> }): JSX.Element {
  return (
    <dl className="next-definition-rows">
      {rows.map(([term, detail]) => (
        <div key={term}><dt>{term}</dt><dd title={detail}>{detail}</dd></div>
      ))}
    </dl>
  );
}

function InspectorEmpty({ icon, title, copy }: { icon: ReactNode; title: string; copy: string }): JSX.Element {
  return <div className="next-inspector-empty"><span>{icon}</span><strong>{title}</strong><p>{copy}</p></div>;
}

function WorkbenchEmpty({ onCreate, onOpen }: { onCreate?: () => void; onOpen?: () => void }): JSX.Element {
  return (
    <div className="next-workbench-empty">
      <div className="next-empty-orbit"><span /><span /><FileCode2 size={25} /></div>
      <span className="next-eyebrow">Scenario workbench</span>
      <h1>Turn a browser journey into a stable contract.</h1>
      <p>Create an Agrune scenario or open a workspace that already contains declarative browser flows.</p>
      <div><button type="button" className="next-primary-action" disabled={!onCreate} onClick={onCreate}><Plus size={14} /> New scenario</button><button type="button" className="next-secondary-action" disabled={!onOpen} onClick={onOpen}><FolderOpen size={14} /> Open workspace</button></div>
    </div>
  );
}

function StudioNextLoading({ className }: { className?: string }): JSX.Element {
  return (
    <div className={mergeClassNames('next-studio', 'next-state-only', className)}>
      <header className="next-titlebar"><div className="next-title-brand"><BrandMark /><span>Agrune</span><span className="next-product-name">Studio</span></div></header>
      <div className="next-loading-layout">
        <aside><div className="next-skeleton-block short" /><div className="next-skeleton-block" /><div className="next-skeleton-block" /><div className="next-skeleton-block" /></aside>
        <main>
          <div className="next-loading-message"><BrandMark /><LoaderCircle size={15} className="next-spin" /><strong>Opening Agrune workspace</strong><span>Loading workspace configuration and starting the controlled Chromium session…</span></div>
          <div className="next-loading-panels"><div /><div /></div>
        </main>
        <aside><div className="next-skeleton-block short" /><div className="next-skeleton-block tall" /><div className="next-skeleton-block" /></aside>
      </div>
    </div>
  );
}

function StudioNextFailure({ className, message, onRetry }: { className?: string; message: string; onRetry?: () => void }): JSX.Element {
  return (
    <div className={mergeClassNames('next-studio', 'next-state-only', className)}>
      <header className="next-titlebar"><div className="next-title-brand"><BrandMark /><span>Agrune</span><span className="next-product-name">Studio</span></div></header>
      <div className="next-fatal-state">
        <div className="next-fatal-icon"><TriangleAlert size={24} /></div>
        <span className="next-eyebrow">Connection error</span>
        <h1>Studio could not open this workspace.</h1>
        <p>{message}</p>
        <div><button type="button" className="next-primary-action" disabled={!onRetry} onClick={onRetry}><Zap size={14} /> Retry connection</button></div>
        <code>Check the workspace configuration and try starting the controlled browser again.</code>
      </div>
    </div>
  );
}

import type { Scenario } from '../scenario';

export type EngineStatus = 'idle' | 'starting' | 'ready' | 'error';
export type RunStatus = 'idle' | 'running' | 'paused' | 'stopping' | 'finalizing' | 'passed' | 'failed' | 'stopped';
export type StepStatus = 'queued' | 'running' | 'passed' | 'failed' | 'skipped';
export type ScenarioSource = 'built-in' | 'workspace';

export interface StudioScenarioItem {
  /** Stable Studio library key. This remains present when scenario.id is omitted. */
  key: string;
  source: ScenarioSource;
  readOnly: boolean;
  /** Path relative to the workspace scenario directory. */
  fileName?: string;
  document: Scenario;
  modifiedAt?: string;
}

export interface StepRunState {
  index: number;
  id: string;
  summary: string;
  family: 'action' | 'assertion';
  kind: string;
  targetRef?: string;
  status: StepStatus;
  startedAt?: number;
  durationMs?: number;
  error?: string;
}

export interface ActivityEntry {
  id: string;
  timestamp: number;
  tone: 'neutral' | 'info' | 'success' | 'warning' | 'error';
  kind: 'system' | 'perception' | 'resolution' | 'action' | 'assertion' | 'artifact' | 'error';
  title: string;
  detail?: string;
  stepId?: string;
  targetRef?: string;
  durationMs?: number;
}

export interface ManifestTargetView {
  targetId: string;
  groupId: string;
  groupName?: string;
  name: string;
  description: string;
  actionKinds: string[];
  selector: string;
  visible: boolean;
  inViewport: boolean;
  enabled: boolean;
  covered: boolean;
  actionable: boolean;
  reason: string;
  domResolved: boolean;
  overlay: boolean;
  sensitive: boolean;
  textPreview?: string;
  repeat?: { repeatId: string; index: number; key: string };
  source?: { file: string; line: number; column: number };
}

export interface ManifestGroupView {
  groupId: string;
  name?: string;
  description?: string;
  targetIds: string[];
}

export interface ResolutionEvidence {
  ref: string;
  status: 'resolved' | 'recovered' | 'unresolved' | 'ambiguous' | 'pending';
  capturedAt: number;
  target?: ManifestTargetView;
  message?: string;
  recovery?: {
    engine: 'playwright';
    causeCode: 'MANIFEST_NOT_FOUND' | 'TARGET_NOT_FOUND';
    strategy: 'role' | 'label' | 'placeholder' | 'testId';
    query: string;
    matchCount: number;
  };
}

export interface ArtifactView {
  id: string;
  kind: 'trace' | 'screenshot' | 'run-log';
  label: string;
  path: string;
  createdAt: number;
}

export interface WorkspaceIssue {
  path: string;
  message: string;
}

export interface StudioState {
  engine: {
    status: EngineStatus;
    message: string;
  };
  workspace: {
    name: string;
    path: string;
    baseUrl: string;
    manifestPath: string;
    scenarioDir: string;
    artifactDir: string;
    configured: boolean;
    issues: WorkspaceIssue[];
  };
  browser: {
    connected: boolean;
    loading: boolean;
    headed: true;
    url: string;
    title: string;
    targetCount: number;
    groupCount: number;
    snapshotVersion?: number;
    capturedAt?: number;
    targets: ManifestTargetView[];
    groups: ManifestGroupView[];
    activeTargetRef?: string;
  };
  scenarios: StudioScenarioItem[];
  selectedScenarioKey: string;
  run: {
    id?: string;
    status: RunStatus;
    scenarioKey?: string;
    scenarioName?: string;
    /** Exact validated document used for this run, including unsaved draft edits. */
    document?: Scenario;
    startedAt?: number;
    finishedAt?: number;
    currentStepIndex: number;
    currentStepId?: string;
    steps: StepRunState[];
    error?: string;
  };
  evidence: {
    resolution?: ResolutionEvidence;
    artifacts: ArtifactView[];
  };
  diagnostics: {
    console: Array<{ level: string; text: string; timestamp: number }>;
    network: Array<{
      method: string;
      url: string;
      status?: number;
      failureText?: string;
      timestamp: number;
    }>;
  };
  activity: ActivityEntry[];
}

export type BrowserHistoryAction = 'back' | 'forward' | 'reload';

export interface SaveScenarioRequest {
  scenario: Scenario;
  /** Existing relative file path or a new `*.agrune.json` name. */
  fileName?: string;
}

export interface RunScenarioRequest {
  scenario: Scenario;
  /** Library row the draft originated from. Omit for a new, unsaved draft. */
  scenarioKey?: string;
}

export interface OpenArtifactRequest {
  path: string;
  mode: 'open' | 'reveal';
}

export interface StudioApi {
  getState: () => Promise<StudioState>;
  chooseWorkspace: () => Promise<StudioState>;
  openWorkspace: (workspacePath: string) => Promise<StudioState>;
  navigate: (url: string) => Promise<StudioState>;
  history: (action: BrowserHistoryAction) => Promise<StudioState>;
  selectScenario: (scenarioKey: string) => Promise<StudioState>;
  saveScenario: (request: SaveScenarioRequest) => Promise<StudioState>;
  runScenario: (request: RunScenarioRequest) => Promise<StudioState>;
  pauseRun: () => Promise<StudioState>;
  resumeRun: () => Promise<StudioState>;
  stepRun: (request: RunScenarioRequest) => Promise<StudioState>;
  stopRun: () => Promise<StudioState>;
  showBrowser: () => Promise<StudioState>;
  highlightTarget: (targetRef: string) => Promise<StudioState>;
  openArtifact: (request: OpenArtifactRequest) => Promise<void>;
  refresh: () => Promise<StudioState>;
  onState: (listener: (state: StudioState) => void) => () => void;
}

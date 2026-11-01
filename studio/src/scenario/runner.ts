import { describeScenarioStep, getStepTargetRef } from './helpers';
import {
  isActionStep,
  isAssertionStep,
  isSecretFillStep,
  type ActionStep,
  type AssertionStep,
  type PlaywrightFallbackActionStep,
  type PlaywrightFallbackLocator,
  type Scenario,
  type ScenarioManifestPin,
  type ScenarioStep,
} from './types';
import { parseScenario } from './validation';

/**
 * The small public BrowserSession surface required by the scenario runner.
 * The current Agrune BrowserSession satisfies this interface structurally, and
 * daemon/Electron clients can provide an adapter without importing Playwright.
 */
export interface ScenarioRuntime {
  readonly tabCount: number;
  open(url: string): Promise<unknown>;
  navigate(url: string, tabId?: number): Promise<unknown>;
  listTabs(): Promise<ScenarioRuntimeTab[]>;
  snapshot(tabId?: number): Promise<ScenarioRuntimeSnapshot>;
  click(tabId: number | undefined, ref: string, action?: string): Promise<unknown>;
  fill(
    tabId: number | undefined,
    ref: string,
    value: string,
    clear?: boolean,
    strategy?: 'auto' | 'insert' | 'keystroke',
  ): Promise<unknown>;
  type(tabId: number | undefined, ref: string, text: string, delayMs?: number, submit?: boolean): Promise<void>;
  press(tabId: number | undefined, key: string, ref?: string, delayMs?: number): Promise<void>;
  select(tabId: number | undefined, ref: string, values: Array<{ value: string }>): Promise<unknown>;
  check(tabId: number | undefined, ref: string): Promise<void>;
  uncheck(tabId: number | undefined, ref: string): Promise<void>;
  waitForTarget(
    tabId: number | undefined,
    ref: string,
    state: 'visible' | 'hidden' | 'enabled' | 'disabled',
    timeoutMs?: number,
  ): Promise<void>;
  waitForTime(tabId: number | undefined, ms: number): Promise<void>;
  read(tabId?: number): Promise<string>;
  consoleMessages(
    tabId: number | undefined,
    query?: { level?: 'debug' | 'info' | 'warning' | 'error'; all?: boolean },
  ): ScenarioRuntimeConsoleMessage[];
  networkRequests(
    tabId: number | undefined,
    query?: { filter?: string; includeStatic?: boolean; all?: boolean },
  ): ScenarioRuntimeNetworkRequest[];
}

export interface ScenarioRuntimeTab {
  tabId: number;
  index: number;
  url: string;
  title: string;
  active: boolean;
}

export interface ScenarioRuntimeSnapshotTarget {
  targetId: string;
  visible: boolean;
  enabled: boolean;
  sensitive?: boolean;
  actionKinds?: string[];
  reason?: string;
  repeatInstance?: { repeatId: string; index: number; key: string };
}

export interface ScenarioRuntimeSnapshot {
  schemaVersion: number;
  url: string;
  title: string;
  targets: ScenarioRuntimeSnapshotTarget[];
}

export interface ScenarioRuntimeConsoleMessage {
  level: string;
  timestamp: number;
  text?: string;
}

export interface ScenarioRuntimeNetworkRequest {
  method: string;
  url: string;
  timestamp: number;
  status?: number;
}

export type PlaywrightRecoveryCauseCode = 'MANIFEST_NOT_FOUND' | 'TARGET_NOT_FOUND';

/**
 * Request handed to the Studio/host after, and only after, the normal manifest
 * action failed with an explicitly recoverable Agrune error code.
 */
export interface PlaywrightRecoveryRequest {
  step: PlaywrightFallbackActionStep;
  locator: PlaywrightFallbackLocator;
  causeCode: PlaywrightRecoveryCauseCode;
  causeMessage: string;
  /** Present only for non-secret literal fill actions. */
  fillValue?: string;
}

export interface PlaywrightRecoveryResult {
  /** Human-readable locator summary, safe to retain in run evidence. */
  description: string;
  /** The host must report the number of live matches it considered. */
  matchCount: number;
  changed?: boolean;
}

export interface PlaywrightRecoveryMetadata {
  engine: 'playwright';
  causeCode: PlaywrightRecoveryCauseCode;
  locator: PlaywrightFallbackLocator;
  description: string;
  matchCount: number;
}

export interface ScenarioStepExecution {
  changed?: boolean;
  recovery?: PlaywrightRecoveryMetadata;
}

export type ScenarioExecutionErrorCode =
  | 'ACTION_FAILED'
  | 'ASSERTION_FAILED'
  | 'SECRET_RESOLVER_REQUIRED'
  | 'SECRET_REQUIRED'
  | 'SECRET_RESOLUTION_FAILED'
  | 'SECRET_NOT_FOUND'
  | 'MANIFEST_PIN_FAILED'
  | 'MANIFEST_PIN_UNVERIFIABLE'
  | 'RUNTIME_ERROR';

export class ScenarioExecutionError extends Error {
  readonly code: ScenarioExecutionErrorCode;

  constructor(code: ScenarioExecutionErrorCode, message: string, options: { cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ScenarioExecutionError';
    this.code = code;
  }
}

export interface ManifestPinVerificationContext {
  pin: ScenarioManifestPin;
  snapshot: ScenarioRuntimeSnapshot;
  tab: ScenarioRuntimeTab;
}

export type ManifestPinVerificationResult =
  | { ok: true }
  | { ok: false; message: string };

export type ScenarioRunStatus = 'passed' | 'failed' | 'cancelled';
export type ScenarioStepRunStatus = 'passed' | 'failed' | 'skipped';

export interface ScenarioStepResult {
  index: number;
  id?: string;
  family: 'action' | 'assertion';
  kind: string;
  summary: string;
  targetRef?: string;
  status: ScenarioStepRunStatus;
  startedAt?: number;
  durationMs: number;
  changed?: boolean;
  recovery?: PlaywrightRecoveryMetadata;
  error?: { code: ScenarioExecutionErrorCode; message: string };
  diagnostics?: { consoleErrors: number; networkRequests: number };
}

export interface ScenarioRunReport {
  scenarioId?: string;
  scenarioName: string;
  status: ScenarioRunStatus;
  startedAt: number;
  finishedAt: number;
  durationMs: number;
  passed: number;
  failed: number;
  skipped: number;
  steps: ScenarioStepResult[];
  error?: { code: ScenarioExecutionErrorCode; message: string };
  /** Observer hook failures never alter test semantics, but remain diagnosable. */
  observerErrors: string[];
}

export type ScenarioRunEvent =
  | { type: 'run-started'; scenarioId?: string; scenarioName: string; startedAt: number }
  | { type: 'step-started'; index: number; id?: string; summary: string; startedAt: number }
  | { type: 'step-finished'; result: ScenarioStepResult }
  | { type: 'run-finished'; report: ScenarioRunReport };

export interface ScenarioRunOptions {
  /** Resolve a vault reference. Resolved values are never emitted or retained by the runner. */
  resolveSecret?: (secretRef: string) => string | undefined | Promise<string | undefined>;
  /** Required when manifest.appVersion is pinned; current snapshots do not expose appVersion. */
  verifyManifestPin?: (
    context: ManifestPinVerificationContext,
  ) => ManifestPinVerificationResult | Promise<ManifestPinVerificationResult>;
  /** Stop after the first failed step. Defaults to true. */
  stopOnFailure?: boolean;
  /** Cooperative cancellation is observed between steps. */
  signal?: AbortSignal;
  /** Best-effort event hook for Studio timelines. Hook failures are collected in observerErrors. */
  onEvent?: (event: ScenarioRunEvent) => void | Promise<void>;
  /** Used by waitFor when the step has no timeout. Defaults to 10 seconds. */
  defaultTimeoutMs?: number;
  /**
   * Execute the same semantic action through a closed Playwright locator hint.
   * The runner calls this only for MANIFEST_NOT_FOUND or TARGET_NOT_FOUND and
   * accepts success only when the host reports exactly one match.
   */
  recoverWithPlaywright?: (request: PlaywrightRecoveryRequest) => Promise<PlaywrightRecoveryResult>;
  /** Test/host clock injection. */
  now?: () => number;
}

interface ExecutionContext {
  scenario: Scenario;
  runtime: ScenarioRuntime;
  runStartedAt: number;
  options: ScenarioRunOptions;
}

/**
 * Run a strict scenario against an already-started Agrune BrowserSession/runtime.
 * The runner never starts or stops the browser, preserving single-session ownership.
 */
export async function runScenario(
  runtime: ScenarioRuntime,
  input: Scenario,
  options: ScenarioRunOptions = {},
): Promise<ScenarioRunReport> {
  const scenario = parseScenario(input);
  const now = options.now ?? Date.now;
  const startedAt = now();
  const observerErrors: string[] = [];
  const steps: ScenarioStepResult[] = [];
  const report: ScenarioRunReport = {
    ...(scenario.id ? { scenarioId: scenario.id } : {}),
    scenarioName: scenario.name,
    status: 'failed',
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    steps,
    observerErrors,
  };
  const emit = async (event: ScenarioRunEvent): Promise<void> => {
    if (!options.onEvent) return;
    try {
      await options.onEvent(event);
    } catch (error) {
      observerErrors.push(safeErrorMessage(error));
    }
  };

  await emit({
    type: 'run-started',
    ...(scenario.id ? { scenarioId: scenario.id } : {}),
    scenarioName: scenario.name,
    startedAt,
  });

  const context: ExecutionContext = { scenario, runtime, runStartedAt: startedAt, options };
  let pinVerified = false;

  try {
    if (scenario.url) {
      await openOrNavigate(runtime, scenario.url);
      await verifyManifestPin(context);
      pinVerified = true;
    } else if (runtime.tabCount > 0) {
      await verifyManifestPin(context);
      pinVerified = true;
    }
  } catch (error) {
    const normalized = normalizeExecutionError(error, 'RUNTIME_ERROR');
    report.error = { code: normalized.code, message: normalized.message };
  }

  let shouldSkip = report.error !== undefined;
  for (let index = 0; index < scenario.steps.length; index += 1) {
    const step = scenario.steps[index]!;
    if (!shouldSkip && options.signal?.aborted) {
      shouldSkip = true;
      report.status = 'cancelled';
    }
    if (shouldSkip) {
      const skipped = skippedStepResult(step, index);
      steps.push(skipped);
      report.skipped += 1;
      continue;
    }

    const stepStartedAt = now();
    const display = describeScenarioStep(step);
    const summary = display.detail ? `${display.title}: ${display.detail}` : display.title;
    await emit({
      type: 'step-started',
      index,
      ...(step.id ? { id: step.id } : {}),
      summary,
      startedAt: stepStartedAt,
    });

    let result: ScenarioStepResult;
    try {
      if (!pinVerified && !(isActionStep(step) && step.do === 'navigate')) {
        await verifyManifestPin(context);
        pinVerified = true;
      }
      const execution = await executeScenarioStep(runtime, step, {
        ...options,
        scenario,
        runStartedAt: startedAt,
      });
      if (isActionStep(step) && step.do === 'navigate') {
        await verifyManifestPin(context);
        pinVerified = true;
      }
      const diagnostics = currentDiagnosticCounts(runtime, startedAt);
      result = {
        index,
        ...(step.id ? { id: step.id } : {}),
        family: isAssertionStep(step) ? 'assertion' : 'action',
        kind: isAssertionStep(step) ? step.assert : step.do,
        summary,
        ...(display.targetRef ? { targetRef: display.targetRef } : {}),
        status: 'passed',
        startedAt: stepStartedAt,
        durationMs: Math.max(0, now() - stepStartedAt),
        ...(execution.changed !== undefined ? { changed: execution.changed } : {}),
        ...(execution.recovery ? { recovery: execution.recovery } : {}),
        diagnostics,
      };
      report.passed += 1;
    } catch (error) {
      const normalized = normalizeExecutionError(error, isAssertionStep(step) ? 'ASSERTION_FAILED' : 'ACTION_FAILED');
      result = {
        index,
        ...(step.id ? { id: step.id } : {}),
        family: isAssertionStep(step) ? 'assertion' : 'action',
        kind: isAssertionStep(step) ? step.assert : step.do,
        summary,
        ...(display.targetRef ? { targetRef: display.targetRef } : {}),
        status: 'failed',
        startedAt: stepStartedAt,
        durationMs: Math.max(0, now() - stepStartedAt),
        error: { code: normalized.code, message: normalized.message },
        diagnostics: currentDiagnosticCounts(runtime, startedAt),
      };
      report.failed += 1;
      if (options.stopOnFailure !== false) shouldSkip = true;
    }
    steps.push(result);
    await emit({ type: 'step-finished', result });
  }

  if (report.status !== 'cancelled') {
    report.status = report.error || report.failed > 0 ? 'failed' : 'passed';
  }
  report.finishedAt = now();
  report.durationMs = Math.max(0, report.finishedAt - report.startedAt);
  await emit({ type: 'run-finished', report });
  return report;
}

export interface ExecuteScenarioStepOptions extends ScenarioRunOptions {
  scenario: Scenario;
  runStartedAt: number;
}

/** Execute one step. This is also the primitive used by Studio's single-step control. */
export async function executeScenarioStep(
  runtime: ScenarioRuntime,
  step: ScenarioStep,
  options: ExecuteScenarioStepOptions,
): Promise<ScenarioStepExecution> {
  if (isAssertionStep(step)) {
    await evaluateScenarioAssertion(runtime, step, options.runStartedAt);
    return {};
  }
  return executeScenarioAction(runtime, step, options);
}

async function executeScenarioAction(
  runtime: ScenarioRuntime,
  step: ActionStep,
  options: ExecuteScenarioStepOptions,
): Promise<ScenarioStepExecution> {
  switch (step.do) {
    case 'navigate': {
      const url = await resolveNavigationUrl(runtime, step.url, options.scenario.url);
      await openOrNavigate(runtime, url);
      return {};
    }
    case 'click':
    case 'dblclick':
    case 'contextmenu':
    case 'hover':
    case 'longpress': {
      return executeWithPlaywrightFallback(
        step,
        options,
        () => runtime.click(undefined, step.ref, step.do),
      );
    }
    case 'fill': {
      if (isSecretFillStep(step)) {
        if (!options.resolveSecret) {
          throw new ScenarioExecutionError(
            'SECRET_RESOLVER_REQUIRED',
            `Fill target "${step.ref}" requires secretRef "${step.secretRef}", but no secret resolver is configured.`,
          );
        }
        let secret: string | undefined;
        try {
          secret = await options.resolveSecret(step.secretRef);
        } catch {
          // A vault implementation is outside this domain and may put sensitive
          // material in its exception. Treat it like the browser fill boundary.
          throw new ScenarioExecutionError(
            'SECRET_RESOLUTION_FAILED',
            `SecretRef "${step.secretRef}" could not be resolved; resolver detail was suppressed.`,
          );
        }
        if (secret === undefined) {
          throw new ScenarioExecutionError('SECRET_NOT_FOUND', `SecretRef "${step.secretRef}" is not configured.`);
        }
        try {
          const result = await runtime.fill(
            undefined,
            step.ref,
            secret,
            step.clear ?? true,
            step.strategy ?? 'auto',
          );
          return changedResult(result);
        } catch (error) {
          // Playwright call logs can echo fill arguments. Never retain the underlying
          // error for secret fills, even as `cause` on an exported report error.
          throw new ScenarioExecutionError(
            'ACTION_FAILED',
            `Fill target "${step.ref}" failed while using secretRef "${step.secretRef}"; runtime detail was suppressed.`,
          );
        }
      }
      return executeWithPlaywrightFallback(
        step,
        options,
        async () => {
          const declaredTarget = findSnapshotTarget(await runtime.snapshot(), step.ref);
          if (declaredTarget?.sensitive) {
            throw new ScenarioExecutionError(
              'SECRET_REQUIRED',
              `Manifest target "${step.ref}" is sensitive and must be filled with secretRef, not an inline value.`,
            );
          }
          return runtime.fill(
            undefined,
            step.ref,
            step.value,
            step.clear ?? true,
            step.strategy ?? 'auto',
          );
        },
        step.value,
      );
    }
    case 'type':
      return executeWithPlaywrightFallback(
        step,
        options,
        () => runtime.type(undefined, step.ref, step.text, step.delayMs, step.submit ?? false),
      );
    case 'press': {
      if (!step.ref) {
        await runtime.press(undefined, step.key, undefined, step.delayMs);
        return {};
      }
      return executeWithPlaywrightFallback(
        step as PlaywrightFallbackActionStep,
        options,
        () => runtime.press(undefined, step.key, step.ref, step.delayMs),
      );
    }
    case 'select':
      return executeWithPlaywrightFallback(
        step,
        options,
        () => runtime.select(undefined, step.ref, [{ value: step.value }]),
      );
    case 'check':
      return executeWithPlaywrightFallback(step, options, () => runtime.check(undefined, step.ref));
    case 'uncheck':
      return executeWithPlaywrightFallback(step, options, () => runtime.uncheck(undefined, step.ref));
    case 'wait':
      await runtime.waitForTime(undefined, step.ms);
      return {};
    case 'waitFor':
      return executeWithPlaywrightFallback(
        step,
        options,
        () => runtime.waitForTarget(
          undefined,
          step.ref,
          step.state,
          step.timeoutMs ?? options.defaultTimeoutMs ?? 10_000,
        ),
      );
  }
}

async function executeWithPlaywrightFallback(
  step: PlaywrightFallbackActionStep,
  options: ExecuteScenarioStepOptions,
  executeManifestAction: () => Promise<unknown>,
  fillValue?: string,
): Promise<ScenarioStepExecution> {
  try {
    return changedResult(await executeManifestAction());
  } catch (error) {
    const causeCode = playwrightRecoveryCauseCode(error);
    const locator = step.playwrightFallback;
    if (!causeCode || !locator || !options.recoverWithPlaywright) throw error;

    const requestStep = { ...step, playwrightFallback: { ...locator } } as PlaywrightFallbackActionStep;
    const recovered = await options.recoverWithPlaywright({
      step: requestStep,
      locator: { ...locator },
      causeCode,
      causeMessage: safeErrorMessage(error),
      ...(fillValue !== undefined ? { fillValue } : {}),
    });

    if (!isPlaywrightRecoveryResult(recovered)) {
      throw new ScenarioExecutionError(
        'ACTION_FAILED',
        `Playwright recovery for "${step.ref}" returned an invalid host result.`,
      );
    }
    if (recovered.matchCount !== 1) {
      throw new ScenarioExecutionError(
        'ACTION_FAILED',
        `Playwright recovery for "${step.ref}" matched ${recovered.matchCount} elements; exactly one is required.`,
      );
    }

    const description = recovered.description.trim();
    return {
      ...(recovered.changed !== undefined ? { changed: recovered.changed } : {}),
      recovery: {
        engine: 'playwright',
        causeCode,
        locator: { ...locator },
        description: description.length <= 2_000 ? description : `${description.slice(0, 1_999)}…`,
        matchCount: recovered.matchCount,
      },
    };
  }
}

function playwrightRecoveryCauseCode(error: unknown): PlaywrightRecoveryCauseCode | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return code === 'MANIFEST_NOT_FOUND' || code === 'TARGET_NOT_FOUND' ? code : undefined;
}

function isPlaywrightRecoveryResult(value: unknown): value is PlaywrightRecoveryResult {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlaywrightRecoveryResult>;
  return (
    typeof candidate.description === 'string' &&
    candidate.description.trim().length > 0 &&
    typeof candidate.matchCount === 'number' &&
    Number.isInteger(candidate.matchCount) &&
    candidate.matchCount >= 0 &&
    (candidate.changed === undefined || typeof candidate.changed === 'boolean')
  );
}

/** Evaluate one closed assertion. */
export async function evaluateScenarioAssertion(
  runtime: ScenarioRuntime,
  step: AssertionStep,
  runStartedAt = 0,
): Promise<void> {
  switch (step.assert) {
    case 'urlContains': {
      const tab = await activeTab(runtime);
      if (!tab.url.includes(step.value)) {
        failAssertion(`URL does not contain ${JSON.stringify(step.value)}.`);
      }
      return;
    }
    case 'urlEquals': {
      const tab = await activeTab(runtime);
      if (tab.url !== step.value) failAssertion(`URL is not equal to ${JSON.stringify(step.value)}.`);
      return;
    }
    case 'titleContains': {
      const tab = await activeTab(runtime);
      if (!tab.title.includes(step.value)) {
        failAssertion(`Page title does not contain ${JSON.stringify(step.value)}.`);
      }
      return;
    }
    case 'textPresent': {
      const text = await runtime.read();
      if (!text.includes(step.value)) failAssertion(`Page text does not contain ${JSON.stringify(step.value)}.`);
      return;
    }
    case 'textAbsent': {
      const text = await runtime.read();
      if (text.includes(step.value)) failAssertion(`Page text unexpectedly contains ${JSON.stringify(step.value)}.`);
      return;
    }
    case 'targetVisible':
    case 'targetHidden':
    case 'targetEnabled':
    case 'targetDisabled': {
      const snapshot = await runtime.snapshot();
      const target = findSnapshotTarget(snapshot, step.ref);
      if (!target) failAssertion(`Manifest target "${step.ref}" did not resolve.`);
      if (step.assert === 'targetVisible' && !target.visible) {
        failAssertion(`Manifest target "${step.ref}" is not visible${target.reason ? ` (${target.reason})` : ''}.`);
      }
      if (step.assert === 'targetHidden' && target.visible) {
        failAssertion(`Manifest target "${step.ref}" is visible.`);
      }
      if (step.assert === 'targetEnabled' && !target.enabled) {
        failAssertion(`Manifest target "${step.ref}" is disabled.`);
      }
      if (step.assert === 'targetDisabled' && target.enabled) {
        failAssertion(`Manifest target "${step.ref}" is enabled.`);
      }
      return;
    }
    case 'targetCount': {
      const snapshot = await runtime.snapshot();
      const keys = new Set(
        snapshot.targets
          .filter((target) => target.repeatInstance?.repeatId === step.repeat)
          .map((target) => target.repeatInstance!.key),
      );
      if (keys.size !== step.count) {
        failAssertion(`Manifest repeat "${step.repeat}" has ${keys.size} instance(s), expected ${step.count}.`);
      }
      return;
    }
    case 'noConsoleErrors': {
      const count = runtime
        .consoleMessages(undefined, { level: 'error', all: true })
        .filter((entry) => entry.timestamp >= runStartedAt).length;
      if (count > 0) failAssertion(`${count} console error(s) occurred during the run.`);
      return;
    }
    case 'networkStatus': {
      const matches = runtime
        .networkRequests(undefined, { all: true, includeStatic: true })
        .filter((request) => request.timestamp >= runStartedAt)
        .filter((request) => request.url.includes(step.urlContains))
        .filter((request) => !step.method || request.method.toUpperCase() === step.method);
      if (matches.length === 0) {
        failAssertion(
          `No ${step.method ? `${step.method} ` : ''}request matched ${JSON.stringify(step.urlContains)} during the run.`,
        );
      }
      if (!matches.some((request) => request.status === step.status)) {
        failAssertion(`No matching request returned HTTP ${step.status}.`);
      }
      return;
    }
  }
}

async function verifyManifestPin(context: ExecutionContext): Promise<void> {
  let snapshot: ScenarioRuntimeSnapshot;
  let tab: ScenarioRuntimeTab;
  try {
    [snapshot, tab] = await Promise.all([context.runtime.snapshot(), activeTab(context.runtime)]);
  } catch (error) {
    throw new ScenarioExecutionError('MANIFEST_PIN_FAILED', `Manifest could not be read: ${safeErrorMessage(error)}`, {
      cause: error,
    });
  }
  const pin = context.scenario.manifest;
  if (snapshot.schemaVersion !== pin.schemaVersion) {
    throw new ScenarioExecutionError(
      'MANIFEST_PIN_FAILED',
      `Manifest schema is v${snapshot.schemaVersion}; scenario requires v${pin.schemaVersion}.`,
    );
  }
  if (pin.origin) {
    let actualOrigin: string;
    try {
      actualOrigin = new URL(tab.url).origin;
    } catch {
      throw new ScenarioExecutionError('MANIFEST_PIN_FAILED', 'The active page has no comparable http(s) origin.');
    }
    if (actualOrigin !== pin.origin) {
      throw new ScenarioExecutionError(
        'MANIFEST_PIN_FAILED',
        `Active origin ${JSON.stringify(actualOrigin)} does not match pinned origin ${JSON.stringify(pin.origin)}.`,
      );
    }
  }
  if (pin.appVersion && !context.options.verifyManifestPin) {
    throw new ScenarioExecutionError(
      'MANIFEST_PIN_UNVERIFIABLE',
      `Manifest appVersion "${pin.appVersion}" is pinned, but the runtime does not expose appVersion; configure verifyManifestPin.`,
    );
  }
  if (context.options.verifyManifestPin) {
    const result = await context.options.verifyManifestPin({ pin, snapshot, tab });
    if (!result.ok) throw new ScenarioExecutionError('MANIFEST_PIN_FAILED', result.message);
  }
}

async function openOrNavigate(runtime: ScenarioRuntime, url: string): Promise<void> {
  if (runtime.tabCount === 0) await runtime.open(url);
  else await runtime.navigate(url);
}

async function resolveNavigationUrl(
  runtime: ScenarioRuntime,
  requested: string,
  scenarioUrl?: string,
): Promise<string> {
  try {
    return new URL(requested).toString();
  } catch {
    // Relative URL: prefer the active page after a prior navigation, then the
    // scenario start URL. Both paths preserve normal browser URL resolution.
  }
  let base = scenarioUrl;
  if (runtime.tabCount > 0) base = (await activeTab(runtime)).url || base;
  if (!base) {
    throw new ScenarioExecutionError(
      'ACTION_FAILED',
      `Relative navigation ${JSON.stringify(requested)} has no active page or scenario url base.`,
    );
  }
  try {
    return new URL(requested, base).toString();
  } catch (error) {
    throw new ScenarioExecutionError('ACTION_FAILED', `Could not resolve navigation URL ${JSON.stringify(requested)}.`, {
      cause: error,
    });
  }
}

async function activeTab(runtime: ScenarioRuntime): Promise<ScenarioRuntimeTab> {
  const tabs = await runtime.listTabs();
  const tab = tabs.find((entry) => entry.active) ?? tabs.at(-1);
  if (!tab) throw new ScenarioExecutionError('RUNTIME_ERROR', 'No active browser tab.');
  return tab;
}

function findSnapshotTarget(
  snapshot: ScenarioRuntimeSnapshot,
  ref: string,
): ScenarioRuntimeSnapshotTarget | undefined {
  return snapshot.targets.find((target) => {
    if (target.targetId === ref) return true;
    const repeat = target.repeatInstance;
    if (!repeat) return false;
    const delimiter = '__agrune_repeatKey_';
    const delimiterIndex = target.targetId.indexOf(delimiter);
    const restStart = delimiterIndex < 0 ? -1 : delimiterIndex + delimiter.length;
    const dotIndex = restStart < 0 ? -1 : target.targetId.indexOf('.', restStart);
    const baseTargetId = dotIndex < 0 ? target.targetId.split('.').at(-1) : target.targetId.slice(dotIndex + 1);
    return `${repeat.repeatId}[key=${repeat.key}].${baseTargetId}` === ref;
  });
}

function currentDiagnosticCounts(runtime: ScenarioRuntime, runStartedAt: number): { consoleErrors: number; networkRequests: number } {
  return {
    consoleErrors: runtime
      .consoleMessages(undefined, { level: 'error', all: true })
      .filter((entry) => entry.timestamp >= runStartedAt).length,
    networkRequests: runtime
      .networkRequests(undefined, { all: true, includeStatic: true })
      .filter((entry) => entry.timestamp >= runStartedAt).length,
  };
}

function changedResult(value: unknown): { changed?: boolean } {
  if (typeof value === 'object' && value !== null && 'changed' in value) {
    const changed = (value as { changed?: unknown }).changed;
    if (typeof changed === 'boolean') return { changed };
  }
  return {};
}

function failAssertion(message: string): never {
  throw new ScenarioExecutionError('ASSERTION_FAILED', message);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length <= 2_000 ? message : `${message.slice(0, 1_999)}…`;
}

function normalizeExecutionError(
  error: unknown,
  fallbackCode: ScenarioExecutionErrorCode,
): ScenarioExecutionError {
  if (error instanceof ScenarioExecutionError) return error;
  return new ScenarioExecutionError(fallbackCode, safeErrorMessage(error), { cause: error });
}

function skippedStepResult(step: ScenarioStep, index: number): ScenarioStepResult {
  const display = describeScenarioStep(step);
  const summary = display.detail ? `${display.title}: ${display.detail}` : display.title;
  return {
    index,
    ...(step.id ? { id: step.id } : {}),
    family: isAssertionStep(step) ? 'assertion' : 'action',
    kind: isAssertionStep(step) ? step.assert : step.do,
    summary,
    ...(getStepTargetRef(step) ? { targetRef: getStepTargetRef(step) } : {}),
    status: 'skipped',
    durationMs: 0,
  };
}

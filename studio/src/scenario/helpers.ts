import {
  ACTION_KINDS,
  ASSERTION_KINDS,
  MANIFEST_SCHEMA_VERSION,
  SCENARIO_SCHEMA_ID,
  isActionStep,
  isAssertionStep,
  isSecretFillStep,
  type ActionKind,
  type AssertionKind,
  type FillStep,
  type LiteralFillStep,
  type Scenario,
  type ScenarioStep,
  type SecretFillStep,
} from './types';

export interface ScenarioStepDescriptor {
  family: 'action' | 'assertion';
  kind: ActionKind | AssertionKind;
  label: string;
  description: string;
  usesTarget: boolean;
}

const ACTION_LABELS: Record<ActionKind, readonly [string, string, boolean]> = {
  navigate: ['Navigate', 'Open an http(s) URL or app-relative route.', false],
  click: ['Click', 'Click a manifest target.', true],
  dblclick: ['Double click', 'Double-click a manifest target.', true],
  contextmenu: ['Context menu', 'Open a manifest target context menu.', true],
  hover: ['Hover', 'Move the pointer over a manifest target.', true],
  longpress: ['Long press', 'Press and hold a manifest target.', true],
  fill: ['Fill', 'Replace or append to a manifest-addressed field.', true],
  type: ['Type', 'Send sequential keystrokes to a manifest target.', true],
  press: ['Press key', 'Press a keyboard key, optionally on a manifest target.', false],
  select: ['Select option', 'Select one value from a manifest target.', true],
  check: ['Check', 'Check a manifest target.', true],
  uncheck: ['Uncheck', 'Uncheck a manifest target.', true],
  wait: ['Wait', 'Wait for a bounded amount of time.', false],
  waitFor: ['Wait for target', 'Wait for a manifest target state.', true],
};

const ASSERTION_LABELS: Record<AssertionKind, readonly [string, string, boolean]> = {
  urlContains: ['URL contains', 'Require the current URL to contain text.', false],
  urlEquals: ['URL equals', 'Require an exact current URL.', false],
  titleContains: ['Title contains', 'Require the page title to contain text.', false],
  textPresent: ['Text present', 'Require text in the visible page body.', false],
  textAbsent: ['Text absent', 'Require text to be absent from the visible page body.', false],
  targetVisible: ['Target visible', 'Require a manifest target to resolve and be visible.', true],
  targetHidden: ['Target hidden', 'Require a manifest target to resolve and be hidden.', true],
  targetEnabled: ['Target enabled', 'Require a manifest target to resolve and be enabled.', true],
  targetDisabled: ['Target disabled', 'Require a manifest target to resolve and be disabled.', true],
  targetCount: ['Repeat count', 'Require a manifest repeat to expose an exact instance count.', false],
  noConsoleErrors: ['No console errors', 'Require no browser console errors during this run.', false],
  networkStatus: ['Network status', 'Require a matching request with the expected HTTP status.', false],
};

/** Stable catalog for an editor's add-step menu. */
export const SCENARIO_STEP_CATALOG: readonly ScenarioStepDescriptor[] = [
  ...ACTION_KINDS.map((kind): ScenarioStepDescriptor => ({
    family: 'action',
    kind,
    label: ACTION_LABELS[kind][0],
    description: ACTION_LABELS[kind][1],
    usesTarget: ACTION_LABELS[kind][2],
  })),
  ...ASSERTION_KINDS.map((kind): ScenarioStepDescriptor => ({
    family: 'assertion',
    kind,
    label: ASSERTION_LABELS[kind][0],
    description: ASSERTION_LABELS[kind][1],
    usesTarget: ASSERTION_LABELS[kind][2],
  })),
];

export interface ScenarioDependencies {
  targetRefs: string[];
  repeatIds: string[];
  secretRefs: string[];
  hasLiteralFills: boolean;
}

export interface StepDisplay {
  family: 'action' | 'assertion';
  kind: ActionKind | AssertionKind;
  title: string;
  detail?: string;
  targetRef?: string;
  secret: boolean;
}

export interface SummarizeStepOptions {
  /** Off by default so timeline/log summaries do not repeat form contents. */
  revealLiteralInput?: boolean;
  maxValueLength?: number;
}

export function getStepKind(step: ScenarioStep): ActionKind | AssertionKind {
  return isActionStep(step) ? step.do : step.assert;
}

export function getStepTargetRef(step: ScenarioStep): string | undefined {
  if (isActionStep(step)) return 'ref' in step ? step.ref : undefined;
  return 'ref' in step ? step.ref : undefined;
}

export function describeScenarioStep(
  step: ScenarioStep,
  options: SummarizeStepOptions = {},
): StepDisplay {
  const value = (input: string): string =>
    JSON.stringify(truncate(input, options.maxValueLength ?? 80));
  const labeled = (fallback: string): string => step.label || fallback;

  if (isAssertionStep(step)) {
    switch (step.assert) {
      case 'urlContains':
      case 'urlEquals':
      case 'titleContains':
      case 'textPresent':
      case 'textAbsent':
        return {
          family: 'assertion',
          kind: step.assert,
          title: labeled(ASSERTION_LABELS[step.assert][0]),
          detail: value(step.value),
          secret: false,
        };
      case 'targetVisible':
      case 'targetHidden':
      case 'targetEnabled':
      case 'targetDisabled':
        return {
          family: 'assertion',
          kind: step.assert,
          title: labeled(ASSERTION_LABELS[step.assert][0]),
          detail: step.ref,
          targetRef: step.ref,
          secret: false,
        };
      case 'targetCount':
        return {
          family: 'assertion',
          kind: step.assert,
          title: labeled(ASSERTION_LABELS[step.assert][0]),
          detail: `${step.repeat} = ${step.count}`,
          secret: false,
        };
      case 'noConsoleErrors':
        return {
          family: 'assertion',
          kind: step.assert,
          title: labeled(ASSERTION_LABELS[step.assert][0]),
          secret: false,
        };
      case 'networkStatus':
        return {
          family: 'assertion',
          kind: step.assert,
          title: labeled(ASSERTION_LABELS[step.assert][0]),
          detail: `${step.method ? `${step.method} ` : ''}${step.urlContains} → ${step.status}`,
          secret: false,
        };
    }
  }

  switch (step.do) {
    case 'navigate':
      return { family: 'action', kind: step.do, title: labeled('Navigate'), detail: step.url, secret: false };
    case 'fill': {
      const secret = isSecretFillStep(step);
      const detail = secret
        ? `<secret:${step.secretRef}>`
        : options.revealLiteralInput
          ? value(step.value)
          : `<value:${step.value.length} chars>`;
      return {
        family: 'action',
        kind: step.do,
        title: labeled('Fill'),
        detail: `${step.ref} ← ${detail}`,
        targetRef: step.ref,
        secret,
      };
    }
    case 'type':
      return {
        family: 'action',
        kind: step.do,
        title: labeled('Type'),
        detail: `${step.ref} ← ${options.revealLiteralInput ? value(step.text) : `<text:${step.text.length} chars>`}`,
        targetRef: step.ref,
        secret: false,
      };
    case 'press':
      return {
        family: 'action',
        kind: step.do,
        title: labeled('Press key'),
        detail: `${step.key}${step.ref ? ` on ${step.ref}` : ''}`,
        ...(step.ref ? { targetRef: step.ref } : {}),
        secret: false,
      };
    case 'select':
      return {
        family: 'action',
        kind: step.do,
        title: labeled('Select option'),
        detail: `${step.ref} ← ${value(step.value)}`,
        targetRef: step.ref,
        secret: false,
      };
    case 'wait':
      return { family: 'action', kind: step.do, title: labeled('Wait'), detail: `${step.ms} ms`, secret: false };
    case 'waitFor':
      return {
        family: 'action',
        kind: step.do,
        title: labeled('Wait for target'),
        detail: `${step.ref} → ${step.state}`,
        targetRef: step.ref,
        secret: false,
      };
    default:
      return {
        family: 'action',
        kind: step.do,
        title: labeled(ACTION_LABELS[step.do][0]),
        detail: step.ref,
        targetRef: step.ref,
        secret: false,
      };
  }
}

export function summarizeScenarioStep(step: ScenarioStep, options: SummarizeStepOptions = {}): string {
  const display = describeScenarioStep(step, options);
  return display.detail ? `${display.title}: ${display.detail}` : display.title;
}

/** Collect manifest/vault dependencies in first-use order, with duplicates removed. */
export function collectScenarioDependencies(scenario: Scenario): ScenarioDependencies {
  const targetRefs: string[] = [];
  const repeatIds: string[] = [];
  const secretRefs: string[] = [];
  const targetSet = new Set<string>();
  const repeatSet = new Set<string>();
  const secretSet = new Set<string>();
  let hasLiteralFills = false;

  for (const step of scenario.steps) {
    const target = getStepTargetRef(step);
    if (target && !targetSet.has(target)) {
      targetSet.add(target);
      targetRefs.push(target);
    }
    if (isAssertionStep(step) && step.assert === 'targetCount' && !repeatSet.has(step.repeat)) {
      repeatSet.add(step.repeat);
      repeatIds.push(step.repeat);
    }
    if (isSecretFillStep(step)) {
      if (!secretSet.has(step.secretRef)) {
        secretSet.add(step.secretRef);
        secretRefs.push(step.secretRef);
      }
    } else if (isActionStep(step) && step.do === 'fill') {
      hasLiteralFills = true;
    }
  }

  return { targetRefs, repeatIds, secretRefs, hasLiteralFills };
}

/** Create a safe, valid starting document for a new editor tab. */
export function createEmptyScenario(name: string, options: { id?: string; url?: string } = {}): Scenario {
  const normalizedName = name.trim() || 'Untitled scenario';
  const id = options.id ?? slugifyId(normalizedName);
  return {
    schema: SCENARIO_SCHEMA_ID,
    ...(id ? { id } : {}),
    name: normalizedName,
    manifest: { schemaVersion: MANIFEST_SCHEMA_VERSION },
    ...(options.url ? { url: options.url } : {}),
    steps: [{ id: 'assert-console-clean', assert: 'noConsoleErrors', label: 'No console errors' }],
  };
}

/** Explicit constructors make the secret/literal fill distinction hard to get wrong in UI code. */
export function createLiteralFillStep(
  ref: string,
  value: string,
  options: Omit<LiteralFillStep, 'do' | 'ref' | 'value' | 'secretRef'> = {},
): FillStep {
  return { do: 'fill', ref, value, ...options };
}

export function createSecretFillStep(
  ref: string,
  secretRef: string,
  options: Omit<SecretFillStep, 'do' | 'ref' | 'value' | 'secretRef' | 'playwrightFallback'> = {},
): FillStep {
  return { do: 'fill', ref, secretRef, ...options };
}

/**
 * Give hand-authored documents stable editor IDs without mutating the source.
 * Existing unique IDs are preserved; missing or duplicate IDs are repaired.
 */
export function ensureScenarioEditorIds(scenario: Scenario): Scenario {
  const scenarioId = scenario.id || slugifyId(scenario.name) || 'scenario';
  const used = new Set<string>();
  const steps = scenario.steps.map((step, index) => {
    const preferred = step.id || `${slugifyId(getStepKind(step)) || 'step'}-${index + 1}`;
    const id = uniqueId(preferred, used);
    used.add(id);
    return step.id === id ? step : { ...step, id };
  });
  return {
    ...scenario,
    id: scenarioId,
    steps,
  };
}

export function moveScenarioStep(scenario: Scenario, fromIndex: number, toIndex: number): Scenario {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= scenario.steps.length) {
    throw new RangeError(`Invalid source step index: ${fromIndex}`);
  }
  if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= scenario.steps.length) {
    throw new RangeError(`Invalid destination step index: ${toIndex}`);
  }
  if (fromIndex === toIndex) return scenario;
  const steps = [...scenario.steps];
  const [step] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, step!);
  return { ...scenario, steps };
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}

function slugifyId(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 120);
}

function uniqueId(preferred: string, used: ReadonlySet<string>): string {
  if (!used.has(preferred)) return preferred;
  let suffix = 2;
  while (used.has(`${preferred}-${suffix}`)) suffix += 1;
  return `${preferred}-${suffix}`;
}

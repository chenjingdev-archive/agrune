/**
 * Agrune's portable, declarative scenario format.
 *
 * A scenario contains data only: manifest-addressed actions and a closed set of
 * assertions. It intentionally has no JavaScript/evaluate escape hatch. Complex
 * tests can still use Playwright directly; this format is the stable, shareable
 * layer for the common browser flows that Agrune can explain and repair.
 */

export const SCENARIO_SCHEMA_ID = 'agrune.scenario/v1' as const;
export const MANIFEST_SCHEMA_VERSION = 3 as const;

export const ACTION_KINDS = [
  'navigate',
  'click',
  'dblclick',
  'contextmenu',
  'hover',
  'longpress',
  'fill',
  'type',
  'press',
  'select',
  'check',
  'uncheck',
  'wait',
  'waitFor',
] as const;

export const ASSERTION_KINDS = [
  'urlContains',
  'urlEquals',
  'titleContains',
  'textPresent',
  'textAbsent',
  'targetVisible',
  'targetHidden',
  'targetEnabled',
  'targetDisabled',
  'targetCount',
  'noConsoleErrors',
  'networkStatus',
] as const;

export type ActionKind = (typeof ACTION_KINDS)[number];
export type AssertionKind = (typeof ASSERTION_KINDS)[number];
export type TargetState = 'visible' | 'hidden' | 'enabled' | 'disabled';
export type FillStrategy = 'auto' | 'insert' | 'keystroke';

/**
 * A closed, data-only Playwright locator used only as a recovery hint after a
 * manifest lookup reports MANIFEST_NOT_FOUND or TARGET_NOT_FOUND.
 *
 * The host remains responsible for translating this into getByRole,
 * getByLabel, getByPlaceholder, or getByTestId. Raw CSS, XPath, coordinates,
 * and arbitrary JavaScript are deliberately not representable.
 */
export interface PlaywrightFallbackLocator {
  by: 'role' | 'label' | 'placeholder' | 'testId';
  /** Required only when by is role; forbidden for the other strategies. */
  role?: string;
  /** Accessible name, label, placeholder text, or test id according to by. */
  name: string;
  /** Hosts should default this to exact matching when it is omitted. */
  exact?: boolean;
}

export interface PlaywrightFallbackStepMetadata {
  playwrightFallback?: PlaywrightFallbackLocator;
}

export interface ScenarioManifestPin {
  /** Must match the manifest schema understood by the runner. */
  schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  /** Optional application origin pin, such as `https://app.example.com`. */
  origin?: string;
  /** Optional application-defined version. A runtime verifier is required to enforce it. */
  appVersion?: string;
}

export interface StepMetadata {
  /** Stable editor identity. Optional for hand-authored scenarios. */
  id?: string;
  /** Human-readable intent shown in run timelines. */
  label?: string;
}

export interface NavigateStep extends StepMetadata {
  do: 'navigate';
  /** Absolute http(s) URL, or a path resolved against scenario.url/current page. */
  url: string;
}

export interface TargetActionStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'click' | 'dblclick' | 'contextmenu' | 'hover' | 'longpress';
  ref: string;
}

export interface LiteralFillStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'fill';
  ref: string;
  value: string;
  secretRef?: never;
  clear?: boolean;
  strategy?: FillStrategy;
}

export interface SecretFillStep extends StepMetadata {
  do: 'fill';
  ref: string;
  /** Vault key only. The resolved secret is never part of a Scenario or run report. */
  secretRef: string;
  value?: never;
  /** Sensitive values never cross the Playwright recovery callback boundary. */
  playwrightFallback?: never;
  clear?: boolean;
  strategy?: FillStrategy;
}

/** Exactly one of `value` and `secretRef` is permitted. */
export type FillStep = LiteralFillStep | SecretFillStep;

export interface TypeStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'type';
  ref: string;
  text: string;
  delayMs?: number;
  submit?: boolean;
}

export interface PressStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'press';
  key: string;
  ref?: string;
  delayMs?: number;
}

export interface SelectStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'select';
  ref: string;
  value: string;
}

export interface CheckStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'check' | 'uncheck';
  ref: string;
}

export interface WaitStep extends StepMetadata {
  do: 'wait';
  ms: number;
}

export interface WaitForStep extends StepMetadata, PlaywrightFallbackStepMetadata {
  do: 'waitFor';
  ref: string;
  state: TargetState;
  timeoutMs?: number;
}

export type ActionStep =
  | NavigateStep
  | TargetActionStep
  | FillStep
  | TypeStep
  | PressStep
  | SelectStep
  | CheckStep
  | WaitStep
  | WaitForStep;

/** Target-backed action shape accepted by the Playwright recovery callback. */
export type PlaywrightFallbackActionStep =
  | TargetActionStep
  | LiteralFillStep
  | TypeStep
  | (PressStep & { ref: string })
  | SelectStep
  | CheckStep
  | WaitForStep;

export interface ValueAssertionStep extends StepMetadata {
  assert: 'urlContains' | 'urlEquals' | 'titleContains' | 'textPresent' | 'textAbsent';
  value: string;
}

export interface TargetAssertionStep extends StepMetadata {
  assert: 'targetVisible' | 'targetHidden' | 'targetEnabled' | 'targetDisabled';
  ref: string;
}

export interface TargetCountAssertionStep extends StepMetadata {
  assert: 'targetCount';
  repeat: string;
  count: number;
}

export interface NoConsoleErrorsAssertionStep extends StepMetadata {
  assert: 'noConsoleErrors';
}

export interface NetworkStatusAssertionStep extends StepMetadata {
  assert: 'networkStatus';
  urlContains: string;
  status: number;
  method?: string;
}

export type AssertionStep =
  | ValueAssertionStep
  | TargetAssertionStep
  | TargetCountAssertionStep
  | NoConsoleErrorsAssertionStep
  | NetworkStatusAssertionStep;

export type ScenarioStep = ActionStep | AssertionStep;

export interface Scenario {
  schema: typeof SCENARIO_SCHEMA_ID;
  /** Stable library identity. Optional for portable hand-authored files. */
  id?: string;
  name: string;
  description?: string;
  tags?: string[];
  manifest: ScenarioManifestPin;
  /** Optional URL opened before the first step. Must be absolute http(s). */
  url?: string;
  steps: ScenarioStep[];
}

export function isActionStep(step: ScenarioStep): step is ActionStep {
  return 'do' in step;
}

export function isAssertionStep(step: ScenarioStep): step is AssertionStep {
  return 'assert' in step;
}

export function isSecretFillStep(step: ScenarioStep): step is SecretFillStep {
  return isActionStep(step) && step.do === 'fill' && 'secretRef' in step;
}

import {
  ACTION_KINDS,
  ASSERTION_KINDS,
  MANIFEST_SCHEMA_VERSION,
  SCENARIO_SCHEMA_ID,
  type ActionKind,
  type AssertionKind,
  type Scenario,
  type ScenarioManifestPin,
  type ScenarioStep,
  type StepMetadata,
  type PlaywrightFallbackLocator,
} from './types';

export const SCENARIO_LIMITS = {
  maxSteps: 1_000,
  maxNameLength: 200,
  maxDescriptionLength: 10_000,
  maxLabelLength: 500,
  maxIdLength: 160,
  maxTargetRefLength: 1_024,
  maxFallbackNameLength: 1_024,
  maxValueLength: 100_000,
  maxWaitMs: 60_000,
  maxTimeoutMs: 120_000,
  maxTags: 32,
  maxTagLength: 64,
} as const;

export type ScenarioIssueCode =
  | 'invalid_type'
  | 'required'
  | 'unknown_field'
  | 'invalid_value'
  | 'too_small'
  | 'too_large'
  | 'duplicate'
  | 'exclusive_fields';

export interface ScenarioValidationIssue {
  code: ScenarioIssueCode;
  /** Dot/bracket path suitable for an editor field map, for example `steps[2].ref`. */
  path: string;
  message: string;
}

export interface ScenarioValidationSuccess {
  ok: true;
  /** A fresh, normalized object containing only known fields. */
  scenario: Scenario;
}

export interface ScenarioValidationFailure {
  ok: false;
  errors: ScenarioValidationIssue[];
}

export type ScenarioValidationResult = ScenarioValidationSuccess | ScenarioValidationFailure;

export class ScenarioValidationError extends Error {
  readonly issues: ScenarioValidationIssue[];

  constructor(issues: ScenarioValidationIssue[]) {
    super(formatScenarioIssues(issues));
    this.name = 'ScenarioValidationError';
    this.issues = issues;
  }
}

type PathPart = string | number;
type UnknownRecord = Record<string, unknown>;

const ACTION_KIND_SET = new Set<string>(ACTION_KINDS);
const ASSERTION_KIND_SET = new Set<string>(ASSERTION_KINDS);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const HTTP_METHOD_PATTERN = /^[A-Za-z][A-Za-z0-9!#$%&'*+.^_`|~-]*$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const PLAYWRIGHT_FALLBACK_STRATEGIES = ['role', 'label', 'placeholder', 'testId'] as const;
const PLAYWRIGHT_FALLBACK_STRATEGY_SET = new Set<string>(PLAYWRIGHT_FALLBACK_STRATEGIES);
// Playwright's public getByRole surface. Keeping this closed catches typos at
// authoring time instead of turning recovery into a broad DOM search.
const PLAYWRIGHT_ARIA_ROLES = new Set([
  'alert', 'alertdialog', 'application', 'article', 'banner', 'blockquote', 'button', 'caption',
  'cell', 'checkbox', 'code', 'columnheader', 'combobox', 'complementary', 'contentinfo',
  'definition', 'deletion', 'dialog', 'directory', 'document', 'emphasis', 'feed', 'figure',
  'form', 'generic', 'grid', 'gridcell', 'group', 'heading', 'img', 'insertion', 'link', 'list',
  'listbox', 'listitem', 'log', 'main', 'marquee', 'math', 'meter', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio', 'navigation', 'none', 'note', 'option', 'paragraph',
  'presentation', 'progressbar', 'radio', 'radiogroup', 'region', 'row', 'rowgroup', 'rowheader',
  'scrollbar', 'search', 'searchbox', 'separator', 'slider', 'spinbutton', 'status', 'strong',
  'subscript', 'superscript', 'switch', 'tab', 'table', 'tablist', 'tabpanel', 'term', 'textbox',
  'time', 'timer', 'toolbar', 'tooltip', 'tree', 'treegrid', 'treeitem',
]);

function pathToString(path: readonly PathPart[]): string {
  let output = '';
  for (const part of path) {
    if (typeof part === 'number') output += `[${part}]`;
    else output += output.length === 0 ? part : `.${part}`;
  }
  return output;
}

function issue(
  issues: ScenarioValidationIssue[],
  path: readonly PathPart[],
  code: ScenarioIssueCode,
  message: string,
): void {
  issues.push({ code, path: pathToString(path), message });
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(record: UnknownRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function rejectUnknownFields(
  record: UnknownRecord,
  allowed: readonly string[],
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) issue(issues, [...path, key], 'unknown_field', `Unknown field "${key}".`);
  }
}

interface StringOptions {
  required?: boolean;
  allowEmpty?: boolean;
  trim?: boolean;
  maxLength?: number;
}

function readString(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
  options: StringOptions = {},
): string | undefined {
  if (!hasOwn(record, key)) {
    if (options.required) issue(issues, [...path, key], 'required', `${key} is required.`);
    return undefined;
  }
  const raw = record[key];
  if (typeof raw !== 'string') {
    issue(issues, [...path, key], 'invalid_type', `${key} must be a string.`);
    return undefined;
  }
  const value = options.trim ? raw.trim() : raw;
  if (options.allowEmpty !== true && value.length === 0) {
    issue(issues, [...path, key], 'too_small', `${key} must not be empty.`);
  }
  if (options.maxLength !== undefined && value.length > options.maxLength) {
    issue(issues, [...path, key], 'too_large', `${key} must be at most ${options.maxLength} characters.`);
  }
  return value;
}

function readBoolean(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): boolean | undefined {
  if (!hasOwn(record, key)) return undefined;
  const value = record[key];
  if (typeof value !== 'boolean') {
    issue(issues, [...path, key], 'invalid_type', `${key} must be a boolean.`);
    return undefined;
  }
  return value;
}

interface NumberOptions {
  integer?: boolean;
  min?: number;
  max?: number;
}

function readNumber(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
  options: NumberOptions = {},
): number | undefined {
  if (!hasOwn(record, key)) {
    issue(issues, [...path, key], 'required', `${key} is required.`);
    return undefined;
  }
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    issue(issues, [...path, key], 'invalid_type', `${key} must be a finite number.`);
    return undefined;
  }
  if (options.integer && !Number.isInteger(value)) {
    issue(issues, [...path, key], 'invalid_value', `${key} must be an integer.`);
  }
  if (options.min !== undefined && value < options.min) {
    issue(issues, [...path, key], 'too_small', `${key} must be at least ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    issue(issues, [...path, key], 'too_large', `${key} must be at most ${options.max}.`);
  }
  return value;
}

function readOptionalNumber(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
  options: NumberOptions = {},
): number | undefined {
  if (!hasOwn(record, key)) return undefined;
  return readNumber(record, key, path, issues, options);
}

function readIdentifier(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): string | undefined {
  const value = readString(record, key, path, issues, {
    trim: true,
    maxLength: SCENARIO_LIMITS.maxIdLength,
  });
  if (value !== undefined && value.length > 0 && !ID_PATTERN.test(value)) {
    issue(
      issues,
      [...path, key],
      'invalid_value',
      `${key} must start with a letter or number and contain only letters, numbers, dot, underscore, or hyphen.`,
    );
  }
  return value;
}

function isAbsoluteHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0;
  } catch {
    return false;
  }
}

/** True for an absolute http(s) URL or a non-scheme relative browser URL. */
export function isSafeScenarioNavigationUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0 || CONTROL_CHARACTER_PATTERN.test(trimmed) || trimmed.startsWith('//')) return false;
  if (isAbsoluteHttpUrl(trimmed)) return true;
  // A colon before any slash/query/hash denotes a scheme (`javascript:`, `file:`, and friends).
  const firstDelimiter = trimmed.search(/[/?#]/);
  const colon = trimmed.indexOf(':');
  if (colon >= 0 && (firstDelimiter < 0 || colon < firstDelimiter)) return false;
  return true;
}

function readTargetRef(
  record: UnknownRecord,
  key: string,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): string | undefined {
  const value = readString(record, key, path, issues, {
    required: true,
    trim: true,
    maxLength: SCENARIO_LIMITS.maxTargetRefLength,
  });
  if (value === undefined || value.length === 0) return value;
  if (CONTROL_CHARACTER_PATTERN.test(value) || /\s/.test(value)) {
    issue(issues, [...path, key], 'invalid_value', `${key} must not contain whitespace or control characters.`);
    return value;
  }
  if (value.includes('[')) {
    const repeated = /^([^\[\]]+)\[key=([^\]\r\n]+)\]\.([^\[\]]+)$/.test(value);
    if (!repeated) {
      issue(
        issues,
        [...path, key],
        'invalid_value',
        `${key} must use repeatId[key=instanceKey].targetId syntax for repeated targets.`,
      );
    }
  }
  return value;
}

function readPlaywrightFallback(
  record: UnknownRecord,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): PlaywrightFallbackLocator | undefined {
  if (!hasOwn(record, 'playwrightFallback')) return undefined;
  const fallbackPath = [...path, 'playwrightFallback'];
  const input = record.playwrightFallback;
  if (!isRecord(input)) {
    issue(issues, fallbackPath, 'invalid_type', 'playwrightFallback must be an object.');
    return undefined;
  }

  rejectUnknownFields(input, ['by', 'role', 'name', 'exact'], fallbackPath, issues);
  const rawBy = readString(input, 'by', fallbackPath, issues, { required: true, trim: true });
  const by = rawBy as PlaywrightFallbackLocator['by'] | undefined;
  if (rawBy !== undefined && !PLAYWRIGHT_FALLBACK_STRATEGY_SET.has(rawBy)) {
    issue(
      issues,
      [...fallbackPath, 'by'],
      'invalid_value',
      `by must be one of: ${PLAYWRIGHT_FALLBACK_STRATEGIES.join(', ')}.`,
    );
  }

  const name = readString(input, 'name', fallbackPath, issues, {
    required: true,
    trim: true,
    maxLength: SCENARIO_LIMITS.maxFallbackNameLength,
  });
  if (name !== undefined && CONTROL_CHARACTER_PATTERN.test(name)) {
    issue(issues, [...fallbackPath, 'name'], 'invalid_value', 'name must not contain control characters.');
  }
  const exact = readBoolean(input, 'exact', fallbackPath, issues);

  let role: string | undefined;
  if (rawBy === 'role') {
    role = readString(input, 'role', fallbackPath, issues, { required: true, trim: true, maxLength: 100 });
    if (role !== undefined && !PLAYWRIGHT_ARIA_ROLES.has(role)) {
      issue(issues, [...fallbackPath, 'role'], 'invalid_value', `${JSON.stringify(role)} is not a supported ARIA role.`);
    }
  } else if (hasOwn(input, 'role')) {
    role = readString(input, 'role', fallbackPath, issues, { trim: true, maxLength: 100 });
    issue(issues, [...fallbackPath, 'role'], 'invalid_value', 'role is allowed only when by is role.');
  }

  if (by === undefined || !PLAYWRIGHT_FALLBACK_STRATEGY_SET.has(by) || name === undefined) return undefined;
  if (by === 'role' && role === undefined) return undefined;
  return {
    by,
    ...(role !== undefined ? { role } : {}),
    name,
    ...(exact !== undefined ? { exact } : {}),
  };
}

function readMetadata(
  record: UnknownRecord,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): StepMetadata {
  const id = readIdentifier(record, 'id', path, issues);
  const label = readString(record, 'label', path, issues, {
    trim: true,
    maxLength: SCENARIO_LIMITS.maxLabelLength,
  });
  return {
    ...(id !== undefined ? { id } : {}),
    ...(label !== undefined ? { label } : {}),
  };
}

function parseActionStep(
  record: UnknownRecord,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): ScenarioStep | undefined {
  const rawKind = record.do;
  if (typeof rawKind !== 'string' || !ACTION_KIND_SET.has(rawKind)) {
    issue(
      issues,
      [...path, 'do'],
      typeof rawKind === 'string' ? 'invalid_value' : 'invalid_type',
      `do must be one of: ${ACTION_KINDS.join(', ')}.`,
    );
    return undefined;
  }
  const kind = rawKind as ActionKind;
  const metadata = readMetadata(record, path, issues);

  switch (kind) {
    case 'navigate': {
      rejectUnknownFields(record, ['do', 'url', 'id', 'label'], path, issues);
      const url = readString(record, 'url', path, issues, {
        required: true,
        trim: true,
        maxLength: 8_192,
      });
      if (url !== undefined && url.length > 0 && !isSafeScenarioNavigationUrl(url)) {
        issue(issues, [...path, 'url'], 'invalid_value', 'url must be an http(s) URL or a safe relative URL.');
      }
      return url === undefined ? undefined : { do: 'navigate', url, ...metadata };
    }
    case 'click':
    case 'dblclick':
    case 'contextmenu':
    case 'hover':
    case 'longpress': {
      rejectUnknownFields(record, ['do', 'ref', 'playwrightFallback', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      return ref === undefined
        ? undefined
        : { do: kind, ref, ...(playwrightFallback ? { playwrightFallback } : {}), ...metadata };
    }
    case 'fill': {
      rejectUnknownFields(
        record,
        ['do', 'ref', 'value', 'secretRef', 'clear', 'strategy', 'playwrightFallback', 'id', 'label'],
        path,
        issues,
      );
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      const hasValue = hasOwn(record, 'value');
      const hasSecretRef = hasOwn(record, 'secretRef');
      if (hasSecretRef && hasOwn(record, 'playwrightFallback')) {
        issue(
          issues,
          [...path, 'playwrightFallback'],
          'invalid_value',
          'playwrightFallback is not allowed on secretRef fills.',
        );
      }
      if (hasValue === hasSecretRef) {
        issue(
          issues,
          path,
          'exclusive_fields',
          'fill requires exactly one of value or secretRef.',
        );
      }
      const value = hasValue
        ? readString(record, 'value', path, issues, { allowEmpty: true, maxLength: SCENARIO_LIMITS.maxValueLength })
        : undefined;
      const secretRef = hasSecretRef
        ? readString(record, 'secretRef', path, issues, { trim: true, maxLength: 256 })
        : undefined;
      const clear = readBoolean(record, 'clear', path, issues);
      const rawStrategy = readString(record, 'strategy', path, issues, { trim: true });
      const strategy = rawStrategy as 'auto' | 'insert' | 'keystroke' | undefined;
      if (rawStrategy !== undefined && !['auto', 'insert', 'keystroke'].includes(rawStrategy)) {
        issue(issues, [...path, 'strategy'], 'invalid_value', 'strategy must be auto, insert, or keystroke.');
      }
      const options = {
        ...(clear !== undefined ? { clear } : {}),
        ...(strategy !== undefined ? { strategy } : {}),
        ...metadata,
      };
      if (ref === undefined) return undefined;
      if (hasSecretRef && secretRef !== undefined) return { do: 'fill', ref, secretRef, ...options };
      if (hasValue && value !== undefined) {
        return { do: 'fill', ref, value, ...(playwrightFallback ? { playwrightFallback } : {}), ...options };
      }
      return undefined;
    }
    case 'type': {
      rejectUnknownFields(record, ['do', 'ref', 'text', 'delayMs', 'submit', 'playwrightFallback', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      const text = readString(record, 'text', path, issues, {
        required: true,
        allowEmpty: true,
        maxLength: SCENARIO_LIMITS.maxValueLength,
      });
      const delayMs = readOptionalNumber(record, 'delayMs', path, issues, {
        integer: true,
        min: 0,
        max: 10_000,
      });
      const submit = readBoolean(record, 'submit', path, issues);
      if (ref === undefined || text === undefined) return undefined;
      return {
        do: 'type',
        ref,
        text,
        ...(delayMs !== undefined ? { delayMs } : {}),
        ...(submit !== undefined ? { submit } : {}),
        ...(playwrightFallback ? { playwrightFallback } : {}),
        ...metadata,
      };
    }
    case 'press': {
      rejectUnknownFields(record, ['do', 'key', 'ref', 'delayMs', 'playwrightFallback', 'id', 'label'], path, issues);
      const key = readString(record, 'key', path, issues, { required: true, trim: true, maxLength: 100 });
      const ref = hasOwn(record, 'ref') ? readTargetRef(record, 'ref', path, issues) : undefined;
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      if (playwrightFallback && ref === undefined) {
        issue(
          issues,
          [...path, 'playwrightFallback'],
          'invalid_value',
          'playwrightFallback requires press to declare a manifest ref.',
        );
      }
      const delayMs = readOptionalNumber(record, 'delayMs', path, issues, {
        integer: true,
        min: 0,
        max: 10_000,
      });
      if (key === undefined) return undefined;
      return {
        do: 'press',
        key,
        ...(ref !== undefined ? { ref } : {}),
        ...(delayMs !== undefined ? { delayMs } : {}),
        ...(playwrightFallback ? { playwrightFallback } : {}),
        ...metadata,
      };
    }
    case 'select': {
      rejectUnknownFields(record, ['do', 'ref', 'value', 'playwrightFallback', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      const value = readString(record, 'value', path, issues, {
        required: true,
        allowEmpty: true,
        maxLength: SCENARIO_LIMITS.maxValueLength,
      });
      return ref === undefined || value === undefined
        ? undefined
        : { do: 'select', ref, value, ...(playwrightFallback ? { playwrightFallback } : {}), ...metadata };
    }
    case 'check':
    case 'uncheck': {
      rejectUnknownFields(record, ['do', 'ref', 'playwrightFallback', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      return ref === undefined
        ? undefined
        : { do: kind, ref, ...(playwrightFallback ? { playwrightFallback } : {}), ...metadata };
    }
    case 'wait': {
      rejectUnknownFields(record, ['do', 'ms', 'id', 'label'], path, issues);
      const ms = readNumber(record, 'ms', path, issues, {
        integer: true,
        min: 1,
        max: SCENARIO_LIMITS.maxWaitMs,
      });
      return ms === undefined ? undefined : { do: 'wait', ms, ...metadata };
    }
    case 'waitFor': {
      rejectUnknownFields(record, ['do', 'ref', 'state', 'timeoutMs', 'playwrightFallback', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      const playwrightFallback = readPlaywrightFallback(record, path, issues);
      const rawState = readString(record, 'state', path, issues, { required: true, trim: true });
      if (rawState !== undefined && !['visible', 'hidden', 'enabled', 'disabled'].includes(rawState)) {
        issue(issues, [...path, 'state'], 'invalid_value', 'state must be visible, hidden, enabled, or disabled.');
      }
      const timeoutMs = readOptionalNumber(record, 'timeoutMs', path, issues, {
        integer: true,
        min: 1,
        max: SCENARIO_LIMITS.maxTimeoutMs,
      });
      if (ref === undefined || rawState === undefined) return undefined;
      return {
        do: 'waitFor',
        ref,
        state: rawState as 'visible' | 'hidden' | 'enabled' | 'disabled',
        ...(timeoutMs !== undefined ? { timeoutMs } : {}),
        ...(playwrightFallback ? { playwrightFallback } : {}),
        ...metadata,
      };
    }
  }
}

function parseAssertionStep(
  record: UnknownRecord,
  path: readonly PathPart[],
  issues: ScenarioValidationIssue[],
): ScenarioStep | undefined {
  const rawKind = record.assert;
  if (typeof rawKind !== 'string' || !ASSERTION_KIND_SET.has(rawKind)) {
    issue(
      issues,
      [...path, 'assert'],
      typeof rawKind === 'string' ? 'invalid_value' : 'invalid_type',
      `assert must be one of: ${ASSERTION_KINDS.join(', ')}.`,
    );
    return undefined;
  }
  const kind = rawKind as AssertionKind;
  const metadata = readMetadata(record, path, issues);

  switch (kind) {
    case 'urlContains':
    case 'urlEquals':
    case 'titleContains':
    case 'textPresent':
    case 'textAbsent': {
      rejectUnknownFields(record, ['assert', 'value', 'id', 'label'], path, issues);
      const value = readString(record, 'value', path, issues, {
        required: true,
        maxLength: SCENARIO_LIMITS.maxValueLength,
      });
      return value === undefined ? undefined : { assert: kind, value, ...metadata };
    }
    case 'targetVisible':
    case 'targetHidden':
    case 'targetEnabled':
    case 'targetDisabled': {
      rejectUnknownFields(record, ['assert', 'ref', 'id', 'label'], path, issues);
      const ref = readTargetRef(record, 'ref', path, issues);
      return ref === undefined ? undefined : { assert: kind, ref, ...metadata };
    }
    case 'targetCount': {
      rejectUnknownFields(record, ['assert', 'repeat', 'count', 'id', 'label'], path, issues);
      const repeat = readString(record, 'repeat', path, issues, {
        required: true,
        trim: true,
        maxLength: SCENARIO_LIMITS.maxTargetRefLength,
      });
      if (repeat !== undefined && /[\s\[\]]/.test(repeat)) {
        issue(issues, [...path, 'repeat'], 'invalid_value', 'repeat must be a manifest repeatId.');
      }
      const count = readNumber(record, 'count', path, issues, { integer: true, min: 0, max: 1_000_000 });
      return repeat === undefined || count === undefined
        ? undefined
        : { assert: 'targetCount', repeat, count, ...metadata };
    }
    case 'noConsoleErrors': {
      rejectUnknownFields(record, ['assert', 'id', 'label'], path, issues);
      return { assert: 'noConsoleErrors', ...metadata };
    }
    case 'networkStatus': {
      rejectUnknownFields(record, ['assert', 'urlContains', 'status', 'method', 'id', 'label'], path, issues);
      const urlContains = readString(record, 'urlContains', path, issues, {
        required: true,
        maxLength: 8_192,
      });
      const status = readNumber(record, 'status', path, issues, { integer: true, min: 100, max: 599 });
      const method = readString(record, 'method', path, issues, { trim: true, maxLength: 32 });
      if (method !== undefined && !HTTP_METHOD_PATTERN.test(method)) {
        issue(issues, [...path, 'method'], 'invalid_value', 'method is not a valid HTTP method token.');
      }
      if (urlContains === undefined || status === undefined) return undefined;
      return {
        assert: 'networkStatus',
        urlContains,
        status,
        ...(method !== undefined ? { method: method.toUpperCase() } : {}),
        ...metadata,
      };
    }
  }
}

function parseStep(
  input: unknown,
  index: number,
  issues: ScenarioValidationIssue[],
): ScenarioStep | undefined {
  const path: PathPart[] = ['steps', index];
  if (!isRecord(input)) {
    issue(issues, path, 'invalid_type', 'Each step must be an object.');
    return undefined;
  }
  const hasDo = hasOwn(input, 'do');
  const hasAssert = hasOwn(input, 'assert');
  if (hasDo === hasAssert) {
    issue(
      issues,
      path,
      'exclusive_fields',
      'A step requires exactly one discriminator: do for an action or assert for an assertion.',
    );
    return undefined;
  }
  return hasDo ? parseActionStep(input, path, issues) : parseAssertionStep(input, path, issues);
}

function parseManifestPin(
  input: unknown,
  issues: ScenarioValidationIssue[],
): ScenarioManifestPin | undefined {
  const path = ['manifest'] as const;
  if (!isRecord(input)) {
    issue(issues, path, input === undefined ? 'required' : 'invalid_type', 'manifest must be an object.');
    return undefined;
  }
  rejectUnknownFields(input, ['schemaVersion', 'origin', 'appVersion'], path, issues);
  const schemaVersion = readNumber(input, 'schemaVersion', path, issues, { integer: true });
  if (schemaVersion !== undefined && schemaVersion !== MANIFEST_SCHEMA_VERSION) {
    issue(
      issues,
      [...path, 'schemaVersion'],
      'invalid_value',
      `schemaVersion must be ${MANIFEST_SCHEMA_VERSION}.`,
    );
  }
  const origin = readString(input, 'origin', path, issues, { trim: true, maxLength: 2_048 });
  if (origin !== undefined) {
    try {
      const parsed = new URL(origin);
      if (
        (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
        parsed.origin !== origin ||
        parsed.username.length > 0 ||
        parsed.password.length > 0
      ) {
        issue(issues, [...path, 'origin'], 'invalid_value', 'origin must be a canonical http(s) origin.');
      }
    } catch {
      issue(issues, [...path, 'origin'], 'invalid_value', 'origin must be a canonical http(s) origin.');
    }
  }
  const appVersion = readString(input, 'appVersion', path, issues, { trim: true, maxLength: 200 });
  if (schemaVersion !== MANIFEST_SCHEMA_VERSION) return undefined;
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    ...(origin !== undefined ? { origin } : {}),
    ...(appVersion !== undefined ? { appVersion } : {}),
  };
}

function parseTags(input: unknown, issues: ScenarioValidationIssue[]): string[] | undefined {
  if (input === undefined) return undefined;
  if (!Array.isArray(input)) {
    issue(issues, ['tags'], 'invalid_type', 'tags must be an array of strings.');
    return undefined;
  }
  if (input.length > SCENARIO_LIMITS.maxTags) {
    issue(issues, ['tags'], 'too_large', `tags must contain at most ${SCENARIO_LIMITS.maxTags} entries.`);
  }
  const tags: string[] = [];
  const seen = new Set<string>();
  input.forEach((entry, index) => {
    if (typeof entry !== 'string') {
      issue(issues, ['tags', index], 'invalid_type', 'Each tag must be a string.');
      return;
    }
    const tag = entry.trim();
    if (tag.length === 0) issue(issues, ['tags', index], 'too_small', 'A tag must not be empty.');
    if (tag.length > SCENARIO_LIMITS.maxTagLength) {
      issue(
        issues,
        ['tags', index],
        'too_large',
        `A tag must be at most ${SCENARIO_LIMITS.maxTagLength} characters.`,
      );
    }
    if (seen.has(tag)) issue(issues, ['tags', index], 'duplicate', `Duplicate tag "${tag}".`);
    seen.add(tag);
    tags.push(tag);
  });
  return tags;
}

/**
 * Validate untrusted scenario data and return a normalized, strict Scenario.
 * Unknown fields and unknown verbs are rejected rather than silently stripped.
 */
export function validateScenario(input: unknown): ScenarioValidationResult {
  const errors: ScenarioValidationIssue[] = [];
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [{ code: 'invalid_type', path: '', message: 'Scenario must be an object.' }],
    };
  }

  rejectUnknownFields(input, ['schema', 'id', 'name', 'description', 'tags', 'manifest', 'url', 'steps'], [], errors);

  if (input.schema !== SCENARIO_SCHEMA_ID) {
    issue(errors, ['schema'], hasOwn(input, 'schema') ? 'invalid_value' : 'required', `schema must be "${SCENARIO_SCHEMA_ID}".`);
  }
  const id = readIdentifier(input, 'id', [], errors);
  const name = readString(input, 'name', [], errors, {
    required: true,
    trim: true,
    maxLength: SCENARIO_LIMITS.maxNameLength,
  });
  const description = readString(input, 'description', [], errors, {
    trim: true,
    maxLength: SCENARIO_LIMITS.maxDescriptionLength,
  });
  const tags = parseTags(input.tags, errors);
  const manifest = parseManifestPin(input.manifest, errors);
  const url = readString(input, 'url', [], errors, { trim: true, maxLength: 8_192 });
  if (url !== undefined && !isAbsoluteHttpUrl(url)) {
    issue(errors, ['url'], 'invalid_value', 'Scenario url must be an absolute http(s) URL.');
  }

  const steps: ScenarioStep[] = [];
  if (!Array.isArray(input.steps)) {
    issue(errors, ['steps'], input.steps === undefined ? 'required' : 'invalid_type', 'steps must be an array.');
  } else {
    if (input.steps.length === 0) issue(errors, ['steps'], 'too_small', 'steps must contain at least one step.');
    if (input.steps.length > SCENARIO_LIMITS.maxSteps) {
      issue(errors, ['steps'], 'too_large', `steps must contain at most ${SCENARIO_LIMITS.maxSteps} steps.`);
    }
    input.steps.forEach((step, index) => {
      const parsed = parseStep(step, index, errors);
      if (parsed) steps.push(parsed);
    });
  }

  const stepIds = new Map<string, number>();
  steps.forEach((step, index) => {
    if (!step.id) return;
    const firstIndex = stepIds.get(step.id);
    if (firstIndex !== undefined) {
      issue(errors, ['steps', index, 'id'], 'duplicate', `Step id "${step.id}" is already used by steps[${firstIndex}].`);
    } else {
      stepIds.set(step.id, index);
    }
  });

  if (errors.length > 0 || name === undefined || manifest === undefined || steps.length === 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    scenario: {
      schema: SCENARIO_SCHEMA_ID,
      ...(id !== undefined ? { id } : {}),
      name,
      ...(description !== undefined ? { description } : {}),
      ...(tags !== undefined ? { tags } : {}),
      manifest,
      ...(url !== undefined ? { url } : {}),
      steps,
    },
  };
}

/** Validate or throw a structured ScenarioValidationError. */
export function parseScenario(input: unknown): Scenario {
  const result = validateScenario(input);
  if (!result.ok) throw new ScenarioValidationError(result.errors);
  return result.scenario;
}

export function formatScenarioIssues(issues: readonly ScenarioValidationIssue[]): string {
  if (issues.length === 0) return 'Scenario validation failed.';
  return issues.map((entry) => `${entry.path || '<root>'}: ${entry.message}`).join('\n');
}

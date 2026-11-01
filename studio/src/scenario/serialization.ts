import type { Scenario } from './types';
import {
  ScenarioValidationError,
  parseScenario,
  type ScenarioValidationIssue,
  validateScenario,
} from './validation';

export const SCENARIO_FILE_EXTENSION = '.agrune.json' as const;

export class ScenarioSyntaxError extends Error {
  readonly position?: number;

  constructor(message: string, options: { position?: number; cause?: unknown } = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ScenarioSyntaxError';
    this.position = options.position;
  }
}

export interface SerializeScenarioOptions {
  /** JSON indentation. Defaults to 2 and is clamped to the JSON-supported range 0..10. */
  space?: number;
  /** Portable text files conventionally end in a newline. Defaults to true. */
  trailingNewline?: boolean;
}

export type ScenarioDeserializationResult =
  | { ok: true; scenario: Scenario }
  | { ok: false; kind: 'syntax'; error: ScenarioSyntaxError }
  | { ok: false; kind: 'validation'; errors: ScenarioValidationIssue[] };

/**
 * Serialize a validated scenario as deterministic, human-readable JSON.
 *
 * Validation happens again at the boundary so values received through an IPC
 * cast cannot smuggle unknown fields into a saved scenario file.
 */
export function serializeScenario(input: Scenario, options: SerializeScenarioOptions = {}): string {
  const scenario = parseScenario(input);
  const requestedSpace = options.space ?? 2;
  const space = Number.isFinite(requestedSpace) ? Math.max(0, Math.min(10, Math.trunc(requestedSpace))) : 2;
  const text = JSON.stringify(scenario, null, space);
  return options.trailingNewline === false ? text : `${text}\n`;
}

/** Parse untrusted JSON text and validate it as agrune.scenario/v1. */
export function deserializeScenario(source: string): Scenario {
  if (typeof source !== 'string') {
    throw new ScenarioSyntaxError('Scenario source must be a string.');
  }
  let value: unknown;
  try {
    value = JSON.parse(stripByteOrderMark(source));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    throw new ScenarioSyntaxError(`Invalid scenario JSON: ${message}`, {
      position: extractJsonErrorPosition(message),
      cause: error,
    });
  }
  return parseScenario(value);
}

/** Non-throwing variant intended for editor load/error states. */
export function tryDeserializeScenario(source: string): ScenarioDeserializationResult {
  try {
    const raw = JSON.parse(stripByteOrderMark(source)) as unknown;
    const result = validateScenario(raw);
    return result.ok ? result : { ok: false, kind: 'validation', errors: result.errors };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    return {
      ok: false,
      kind: 'syntax',
      error: new ScenarioSyntaxError(`Invalid scenario JSON: ${message}`, {
        position: extractJsonErrorPosition(message),
        cause: error,
      }),
    };
  }
}

/** Deep clone through the strict serialization boundary. */
export function cloneScenario(scenario: Scenario): Scenario {
  return deserializeScenario(serializeScenario(scenario, { space: 0, trailingNewline: false }));
}

function stripByteOrderMark(source: string): string {
  return source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
}

function extractJsonErrorPosition(message: string): number | undefined {
  const match = /(?:position|column)\s+(\d+)/i.exec(message);
  if (!match?.[1]) return undefined;
  const parsed = Number(match[1]);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

// Keep this import live in generated declarations: callers can distinguish syntax
// and validation exceptions without relying on message text.
export { ScenarioValidationError };

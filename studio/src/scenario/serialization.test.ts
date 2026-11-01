import { describe, expect, it } from 'vitest';
import {
  SCENARIO_SCHEMA_ID,
  ScenarioSyntaxError,
  ScenarioValidationError,
  cloneScenario,
  deserializeScenario,
  serializeScenario,
  tryDeserializeScenario,
  type Scenario,
} from './index';

const scenario: Scenario = {
  schema: SCENARIO_SCHEMA_ID,
  id: 'secret-login',
  name: 'Secret login',
  manifest: { schemaVersion: 3 },
  steps: [
    { do: 'fill', ref: 'login.email', value: 'qa@example.com' },
    { do: 'fill', ref: 'login.password', secretRef: 'qa.login.password' },
    { do: 'click', ref: 'login.submit' },
  ],
};

describe('scenario serialization', () => {
  it('round-trips deterministic JSON with a trailing newline', () => {
    const first = serializeScenario(scenario);
    const second = serializeScenario(deserializeScenario(first));
    expect(first.endsWith('\n')).toBe(true);
    expect(second).toBe(first);
    expect(deserializeScenario(`\ufeff${first}`)).toEqual(scenario);
  });

  it('keeps only secretRef in a secret fill document', () => {
    const text = serializeScenario(scenario);
    expect(text).toContain('"secretRef": "qa.login.password"');
    expect(text).not.toContain('top-secret-runtime-value');
  });

  it('distinguishes JSON syntax failures from valid-JSON schema failures', () => {
    const syntax = tryDeserializeScenario('{"schema":');
    const validation = tryDeserializeScenario('{"schema":"other"}');
    expect(syntax).toMatchObject({ ok: false, kind: 'syntax' });
    expect(validation).toMatchObject({ ok: false, kind: 'validation' });
    expect(() => deserializeScenario('{"schema":')).toThrow(ScenarioSyntaxError);
    expect(() => deserializeScenario('{"schema":"other"}')).toThrow(ScenarioValidationError);
  });

  it('revalidates values crossing the serialization boundary', () => {
    const castWithUnknownField = {
      ...scenario,
      execute: 'rm -rf /',
    } as Scenario;
    expect(() => serializeScenario(castWithUnknownField)).toThrow(ScenarioValidationError);
  });

  it('clones without sharing step references', () => {
    const clone = cloneScenario(scenario);
    expect(clone).toEqual(scenario);
    expect(clone).not.toBe(scenario);
    expect(clone.steps).not.toBe(scenario.steps);
    expect(clone.steps[0]).not.toBe(scenario.steps[0]);
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACTION_KINDS,
  ASSERTION_KINDS,
  SCENARIO_SCHEMA_ID,
  SCENARIO_STEP_CATALOG,
  collectScenarioDependencies,
  createEmptyScenario,
  createLiteralFillStep,
  createSecretFillStep,
  ensureScenarioEditorIds,
  moveScenarioStep,
  summarizeScenarioStep,
  validateScenario,
  type Scenario,
} from './index';

describe('scenario UI helpers', () => {
  it('exposes every closed verb exactly once in the editor catalog', () => {
    expect(SCENARIO_STEP_CATALOG).toHaveLength(ACTION_KINDS.length + ASSERTION_KINDS.length);
    expect(SCENARIO_STEP_CATALOG.map((entry) => entry.kind)).toEqual([...ACTION_KINDS, ...ASSERTION_KINDS]);
  });

  it('collects manifest and vault dependencies in first-use order', () => {
    const scenario: Scenario = {
      schema: SCENARIO_SCHEMA_ID,
      name: 'Dependencies',
      manifest: { schemaVersion: 3 },
      steps: [
        createLiteralFillStep('profile.name', 'Alice'),
        createSecretFillStep('profile.password', 'qa.password'),
        { do: 'click', ref: 'profile.save' },
        { assert: 'targetVisible', ref: 'profile.save' },
        { assert: 'targetCount', repeat: 'members', count: 2 },
        createSecretFillStep('profile.password', 'qa.password'),
      ],
    };

    expect(collectScenarioDependencies(scenario)).toEqual({
      targetRefs: ['profile.name', 'profile.password', 'profile.save'],
      repeatIds: ['members'],
      secretRefs: ['qa.password'],
      hasLiteralFills: true,
    });
  });

  it('redacts form contents in default timeline summaries', () => {
    const literal = { do: 'fill', ref: 'profile.name', value: 'Alice Example' } as const;
    const secret = { do: 'fill', ref: 'profile.password', secretRef: 'qa.password' } as const;
    expect(summarizeScenarioStep(literal)).toBe('Fill: profile.name ← <value:13 chars>');
    expect(summarizeScenarioStep(literal, { revealLiteralInput: true })).toContain('Alice Example');
    expect(summarizeScenarioStep(secret)).toBe('Fill: profile.password ← <secret:qa.password>');
  });

  it('creates a valid skeleton and repairs missing/duplicate editor IDs immutably', () => {
    const empty = createEmptyScenario('  Checkout flow  ', { url: 'https://shop.example.test/' });
    expect(validateScenario(empty).ok).toBe(true);

    const source: Scenario = {
      ...empty,
      steps: [
        { id: 'click-1', do: 'click', ref: 'one' },
        { id: 'click-1', do: 'click', ref: 'two' },
        { do: 'click', ref: 'three' },
      ],
    };
    const repaired = ensureScenarioEditorIds(source);
    expect(repaired).not.toBe(source);
    expect(repaired.steps.map((step) => step.id)).toEqual(['click-1', 'click-1-2', 'click-3']);
    expect(source.steps[2]?.id).toBeUndefined();
    expect(validateScenario(repaired).ok).toBe(true);
  });

  it('moves steps immutably and checks index bounds', () => {
    const scenario: Scenario = {
      schema: SCENARIO_SCHEMA_ID,
      name: 'Move',
      manifest: { schemaVersion: 3 },
      steps: [
        { id: 'a', do: 'click', ref: 'a' },
        { id: 'b', do: 'click', ref: 'b' },
      ],
    };
    const moved = moveScenarioStep(scenario, 0, 1);
    expect(moved.steps.map((step) => step.id)).toEqual(['b', 'a']);
    expect(scenario.steps.map((step) => step.id)).toEqual(['a', 'b']);
    expect(() => moveScenarioStep(scenario, 3, 0)).toThrow(RangeError);
  });
});

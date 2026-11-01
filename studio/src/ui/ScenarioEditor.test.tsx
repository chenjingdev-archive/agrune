import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SCENARIO_SCHEMA_ID, type Scenario } from '../scenario';
import {
  ScenarioEditor,
  scenarioEditorHasChanges,
  stepKindChangeNeedsConfirmation,
} from './ScenarioEditor';

function scenario(): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    id: 'editor-behavior',
    name: 'Editor behavior',
    manifest: { schemaVersion: 3 },
    steps: [{ id: 'open', do: 'click', ref: 'navigation.open' }],
  };
}

describe('ScenarioEditor guard logic', () => {
  it('tracks Builder and raw JSON changes against the original source', () => {
    const initial = scenario();
    const draft = structuredClone(initial);
    const formatted = JSON.stringify(initial, null, 2);

    expect(scenarioEditorHasChanges(initial, draft, 'form', formatted)).toBe(false);
    draft.name = 'Changed name';
    expect(scenarioEditorHasChanges(initial, draft, 'form', formatted)).toBe(true);
    expect(scenarioEditorHasChanges(initial, initial, 'json', formatted)).toBe(false);
    expect(scenarioEditorHasChanges(initial, initial, 'json', JSON.stringify(initial))).toBe(true);
  });

  it('requires confirmation only when a kind change would drop configured fields', () => {
    expect(stepKindChangeNeedsConfirmation({ do: 'click', ref: '' }, 'action:hover')).toBe(false);
    expect(stepKindChangeNeedsConfirmation({ do: 'click', ref: 'checkout.submit' }, 'action:hover')).toBe(true);
    expect(stepKindChangeNeedsConfirmation({ do: 'wait', ms: 500 }, 'action:click')).toBe(true);
    expect(stepKindChangeNeedsConfirmation({ assert: 'noConsoleErrors' }, 'assertion:urlContains')).toBe(false);
    expect(stepKindChangeNeedsConfirmation({ do: 'click', ref: '' }, 'action:click')).toBe(false);
  });

  it('disables every destructive close affordance while an action is active', () => {
    const markup = renderToStaticMarkup(
      <ScenarioEditor
        open
        saving
        scenario={scenario()}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(markup).toContain('role="dialog" aria-modal="true" aria-label="Scenario editor" aria-busy="true"');
    expect(markup).toContain('<fieldset class="scenario-editor-sheet" aria-describedby="scenario-editor-status" disabled=""');
    expect(markup).toContain('aria-label="Close scenario editor" tabindex="-1" disabled=""');
    expect(markup).toContain('aria-label="Close editor" disabled=""');
    expect(markup).toContain('class="secondary" disabled="">Cancel</button>');
    expect(markup).toContain('Saving…');
  });

  it('keeps Save available but blocks Run draft with a persistent manual-control reason', () => {
    const markup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={scenario()}
        runBlockedReason="Exit manual browser control before running this draft."
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(markup).toContain('Exit manual browser control before running this draft.');
    expect(markup).toContain('class="secondary"><svg');
    expect(markup).toContain('class="primary" disabled="" title="Exit manual browser control before running this draft."');
  });
});

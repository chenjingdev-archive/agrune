import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { SCENARIO_SCHEMA_ID, type Scenario } from '../scenario';
import { artifactOpenMode } from './App';
import { ScenarioEditor } from './ScenarioEditor';
import {
  EVIDENCE_ARTIFACT_WARNING,
  StudioNext,
  createStudioNextScenario,
  type StudioNextRunStatus,
  type StudioNextStep,
  type StudioNextViewModel,
} from './StudioNext';

function scenarioWith(steps: Scenario['steps']): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    id: 'ui-safety',
    name: 'UI safety',
    manifest: { schemaVersion: 3 },
    steps,
  };
}

function runModel(status: StudioNextRunStatus, steps: StudioNextStep[], currentStepId?: string): StudioNextViewModel {
  return {
    phase: 'ready',
    workspace: {
      id: 'weather-workspace',
      name: 'Weather QA',
      path: '/tmp/weather-qa',
      baseUrl: 'https://www.naver.com',
      configured: true,
      connected: true,
      sessionLabel: 'headed Chromium · live',
      manifest: { filename: 'manifest.json', groups: 0, targets: 0, coverage: 0, health: 'warning' },
    },
    scenarios: [{
      id: 'naver-weather',
      title: 'Naver weather search',
      intent: 'Search for Seoul weather and verify the results.',
      tags: ['browser'],
      updatedLabel: 'Just now',
      lastRunStatus: status,
      estimatedMs: 6_000,
      steps,
    }],
    gaps: [],
    selectedScenarioId: 'naver-weather',
    selectedStepId: currentStepId,
    timeline: [],
    run: {
      id: 'run-weather',
      status,
      currentStepId,
      elapsedMs: 2_000,
      progress: Math.round((steps.filter((step) => step.status === 'passed').length / steps.length) * 100),
      browserLabel: 'Chromium · external window',
    },
    evidence: [],
  };
}

const weatherSteps: StudioNextStep[] = [
  { id: 'step-1', kind: 'wait', title: 'Search input is ready', status: 'passed', durationMs: 265 },
  { id: 'step-2', kind: 'fill', title: 'Enter Seoul weather', status: 'passed', durationMs: 515 },
  { id: 'step-3', kind: 'press', title: 'Submit weather search', status: 'passed', durationMs: 622 },
  { id: 'step-4', kind: 'expect', title: 'Search results are open', status: 'queued' },
  { id: 'step-5', kind: 'expect', title: 'Search title matches', status: 'queued' },
  { id: 'step-6', kind: 'expect', title: 'Today weather is visible', status: 'queued' },
];

describe('Studio UI safety regressions', () => {
  it('uses the same fallback step IDs as the runtime for imported scenarios without explicit IDs', () => {
    const view = createStudioNextScenario(
      scenarioWith([{ do: 'wait', ms: 10 }]),
      { stepStates: { 'step-1': { status: 'passed', durationMs: 12 } } },
    );

    expect(view.steps[0]).toMatchObject({ id: 'step-1', status: 'passed', durationMs: 12 });
  });

  it('redacts literal fill and typed text from non-editor scenario rows', () => {
    const view = createStudioNextScenario(
      scenarioWith([
        { do: 'fill', ref: 'profile.full_name', value: 'Customer Visible PII' },
        { do: 'type', ref: 'profile.note', text: 'Keyboard-entered private note', submit: true },
      ]),
    );

    expect(view.steps[0]?.detail).toBe('profile.full_name ← <value:20 chars>');
    expect(view.steps[1]?.detail).toBe('profile.note ← <text:29 chars>');
    expect(view.steps[0]?.detail).not.toContain('Customer Visible PII');
    expect(view.steps[1]?.detail).not.toContain('Keyboard-entered private note');
  });

  it('disables creation of secretRef fills and explains the missing runtime support', () => {
    const markup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={scenarioWith([{ do: 'fill', ref: 'login.password', value: '' }])}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(markup).toContain('type="checkbox" disabled=""');
    expect(markup).toContain('Not yet executable');
    expect(markup).toContain('Secret vault execution is not connected yet.');
    expect(markup).toContain('cannot run in Studio yet');
  });

  it('keeps an existing secretRef visible and read-only in Builder without rewriting it', () => {
    const existing = scenarioWith([
      { do: 'fill', ref: 'login.password', secretRef: 'qa/login-password' },
    ]);
    const before = structuredClone(existing);
    const markup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={existing}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(markup).toContain('type="checkbox" disabled="" aria-describedby="scenario-secret-unavailable-0" checked=""');
    expect(markup).toContain('readOnly="" aria-describedby="scenario-secret-unavailable-0" value="qa/login-password"');
    expect(markup).toContain('can be inspected here or edited in JSON');
    expect(markup).toContain('title="Secret vault execution is not connected. You can save this scenario, but it cannot run in Studio yet."');
    expect(markup).toContain('class="primary" disabled=""');
    expect(existing).toEqual(before);
  });

  it('presents Playwright recovery as an explicit manifest-first option', () => {
    const markup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={scenarioWith([{ do: 'click', ref: 'checkout.submit' }])}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(markup).toContain('Playwright recovery');
    expect(markup).toContain('The manifest target always runs first.');
    expect(markup).toContain('aria-label="Enable Playwright recovery"');
    expect(markup).toContain('Keep this off while the manifest target is healthy.');
  });

  it('renders a structured recovery locator and keeps it unavailable for secret fills', () => {
    const configuredMarkup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={scenarioWith([{
          do: 'click',
          ref: 'checkout.submit',
          playwrightFallback: { by: 'role', role: 'button', name: 'Place order', exact: true },
        }])}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );
    const secretMarkup = renderToStaticMarkup(
      <ScenarioEditor
        open
        scenario={scenarioWith([{ do: 'fill', ref: 'login.password', secretRef: 'qa/login-password' }])}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onRun={vi.fn()}
      />,
    );

    expect(configuredMarkup).toContain('Role + accessible name');
    expect(configuredMarkup).toContain('value="button"');
    expect(configuredMarkup).toContain('value="Place order"');
    expect(configuredMarkup).toContain('Exact match');
    expect(secretMarkup).toContain('Recovery locators are disabled for secret fills.');
    expect(secretMarkup).toContain('aria-label="Enable Playwright recovery" aria-describedby="scenario-playwright-recovery-description" disabled=""');
  });

  it('warns that run log, trace, and screenshot artifacts may contain sensitive content', () => {
    expect(EVIDENCE_ARTIFACT_WARNING).toBe(
      'Run logs, Playwright traces, and screenshots can contain sensitive page content. Review every artifact before sharing it.',
    );
    expect(EVIDENCE_ARTIFACT_WARNING).not.toContain('redacted before evidence is written');
  });

  it('opens screenshots directly but reveals logs and traces in Finder', () => {
    expect(artifactOpenMode('screenshot')).toBe('open');
    expect(artifactOpenMode('run-log')).toBe('reveal');
    expect(artifactOpenMode('trace')).toBe('reveal');
  });

  it('names the exact next assertion and does not mark the completed action active', () => {
    const markup = renderToStaticMarkup(
      <StudioNext
        model={runModel('paused', structuredClone(weatherSteps), 'step-3')}
        actions={{ onStep: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onTakeover: vi.fn() }}
      />,
    );

    expect(markup).toContain('Check step 4');
    expect(markup).toContain('Check step 4 of 6: Search results are open. Then pause again.');
    expect(markup).toContain('<em>NEXT</em>');
    expect(markup).not.toContain('<em>ACTIVE</em>');
    expect(markup).not.toContain('Run next step');
  });

  it('shows a running assertion as checking and prevents another step request', () => {
    const steps = structuredClone(weatherSteps);
    steps[3]!.status = 'running';
    const markup = renderToStaticMarkup(
      <StudioNext
        model={runModel('paused', steps, 'step-4')}
        actions={{ onStep: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onTakeover: vi.fn() }}
      />,
    );

    expect(markup).toContain('Checking 4/6');
    expect(markup).toContain('<em>CHECKING</em>');
    expect(markup).toContain('Checking step 4 of 6 · Search results are open');
    expect(markup).toContain('Checking step 4…');
    expect(markup).toContain('Wait for the current semantic step to finish before resuming continuous execution');
    expect(markup).not.toContain('Run next step');
  });

  it('locks controls and explains evidence saving while finalizing', () => {
    const steps = structuredClone(weatherSteps).map((step) => ({ ...step, status: 'passed' as const }));
    const markup = renderToStaticMarkup(
      <StudioNext
        model={runModel('finalizing', steps, 'step-6')}
        actions={{ onStep: vi.fn(), onPause: vi.fn(), onStop: vi.fn(), onTakeover: vi.fn() }}
      />,
    );

    expect(markup).toContain('Finalizing');
    expect(markup).toContain('Saving screenshots, Playwright trace, and run log…');
    expect(markup).toContain('Run evidence is being saved');
    expect(markup).not.toContain('Start step mode');
  });
});

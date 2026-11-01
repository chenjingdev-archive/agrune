import { describe, expect, it } from 'vitest';
import {
  ACTION_KINDS,
  ASSERTION_KINDS,
  SCENARIO_SCHEMA_ID,
  ScenarioValidationError,
  isSafeScenarioNavigationUrl,
  parseScenario,
  validateScenario,
} from './index';

function documentWith(steps: unknown[], overrides: Record<string, unknown> = {}): unknown {
  return {
    schema: SCENARIO_SCHEMA_ID,
    name: 'Account login',
    manifest: { schemaVersion: 3 },
    steps,
    ...overrides,
  };
}

describe('validateScenario', () => {
  it('accepts and normalizes a representative manifest-ref scenario', () => {
    const result = validateScenario(
      documentWith(
        [
          { id: 'open', do: 'navigate', url: '/login' },
          { id: 'email', do: 'fill', ref: 'login.email', value: 'qa@example.com' },
          { id: 'password', do: 'fill', ref: 'login.password', secretRef: 'qa.login.password' },
          { id: 'submit', do: 'click', ref: 'login.submit' },
          { assert: 'networkStatus', method: 'post', urlContains: '/session', status: 201 },
          { assert: 'urlContains', value: '/home' },
        ],
        {
          id: 'login-smoke',
          description: '  Critical login path  ',
          tags: [' smoke ', 'critical'],
          url: 'https://app.example.test/',
          manifest: { schemaVersion: 3, origin: 'https://app.example.test', appVersion: '2026.08' },
        },
      ),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.description).toBe('Critical login path');
    expect(result.scenario.tags).toEqual(['smoke', 'critical']);
    expect(result.scenario.steps[4]).toEqual({
      assert: 'networkStatus',
      urlContains: '/session',
      status: 201,
      method: 'POST',
    });
  });

  it('keeps the action and assertion vocabularies closed', () => {
    expect(ACTION_KINDS).not.toContain('evaluate' as never);
    expect(ASSERTION_KINDS).not.toContain('evalExpression' as never);

    const action = validateScenario(documentWith([{ do: 'evaluate', source: 'process.exit(1)' }]));
    const assertion = validateScenario(documentWith([{ assert: 'evalExpression', value: 'globalThis.secret' }]));

    expect(action.ok).toBe(false);
    expect(assertion.ok).toBe(false);
  });

  it('rejects unknown fields instead of stripping executable-looking data', () => {
    const result = validateScenario(
      documentWith([{ do: 'click', ref: 'login.submit', onClick: 'alert(document.cookie)' }]),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toContainEqual(
      expect.objectContaining({ code: 'unknown_field', path: 'steps[0].onClick' }),
    );
  });

  it('requires exactly one fill source and permits an empty literal', () => {
    expect(validateScenario(documentWith([{ do: 'fill', ref: 'field', value: '' }])).ok).toBe(true);
    expect(validateScenario(documentWith([{ do: 'fill', ref: 'field', secretRef: 'vault.key' }])).ok).toBe(true);
    expect(
      validateScenario(documentWith([{ do: 'fill', ref: 'field', value: 'x', secretRef: 'vault.key' }])).ok,
    ).toBe(false);
    expect(validateScenario(documentWith([{ do: 'fill', ref: 'field' }])).ok).toBe(false);
  });

  it('accepts only closed Playwright fallback locators on target-backed actions', () => {
    const result = validateScenario(documentWith([
      {
        do: 'fill',
        ref: 'search.input',
        value: '서울 날씨',
        playwrightFallback: { by: 'role', role: 'searchbox', name: '  검색어 입력  ', exact: true },
      },
      {
        do: 'click',
        ref: 'search.submit',
        playwrightFallback: { by: 'label', name: '검색', exact: true },
      },
      {
        do: 'type',
        ref: 'search.input',
        text: '서울 날씨',
        playwrightFallback: { by: 'placeholder', name: '검색어를 입력해 주세요' },
      },
      {
        do: 'waitFor',
        ref: 'weather.card',
        state: 'visible',
        playwrightFallback: { by: 'testId', name: 'weather-card' },
      },
    ]));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.scenario.steps[0]).toMatchObject({
      playwrightFallback: { by: 'role', role: 'searchbox', name: '검색어 입력', exact: true },
    });
    expect(result.scenario.steps[1]).toMatchObject({
      playwrightFallback: { by: 'label', name: '검색', exact: true },
    });
  });

  it('rejects broad, malformed, or misplaced Playwright fallbacks', () => {
    const invalid = [
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'css', name: '#submit' } },
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'role', name: 'Submit' } },
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'role', role: 'not-a-role', name: 'Submit' } },
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'label', role: 'textbox', name: 'Email' } },
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'testId', name: 'submit', exact: 'yes' } },
      { do: 'click', ref: 'submit', playwrightFallback: { by: 'testId', name: 'submit', selector: '#submit' } },
      {
        do: 'fill',
        ref: 'login.password',
        secretRef: 'qa.password',
        playwrightFallback: { by: 'label', name: 'Password', exact: true },
      },
      { do: 'navigate', url: '/search', playwrightFallback: { by: 'role', role: 'link', name: 'Search' } },
      { do: 'press', key: 'Enter', playwrightFallback: { by: 'role', role: 'button', name: 'Submit' } },
      { assert: 'targetVisible', ref: 'submit', playwrightFallback: { by: 'role', role: 'button', name: 'Submit' } },
    ];

    for (const step of invalid) expect(validateScenario(documentWith([step])).ok).toBe(false);
  });

  it('pins manifest schema v3 and validates a canonical origin', () => {
    expect(
      validateScenario(documentWith([{ assert: 'noConsoleErrors' }], { manifest: { schemaVersion: 2 } })).ok,
    ).toBe(false);
    expect(
      validateScenario(
        documentWith([{ assert: 'noConsoleErrors' }], {
          manifest: { schemaVersion: 3, origin: 'https://app.example.test/path' },
        }),
      ).ok,
    ).toBe(false);
  });

  it('accepts canonical repeated target refs and rejects malformed ones', () => {
    expect(
      validateScenario(documentWith([{ do: 'click', ref: 'members[key=user-42].open_profile' }])).ok,
    ).toBe(true);
    expect(validateScenario(documentWith([{ do: 'click', ref: 'members[key=].open_profile' }])).ok).toBe(false);
    expect(validateScenario(documentWith([{ do: 'click', ref: 'members[key=user-42]' }])).ok).toBe(false);
  });

  it('rejects unsafe navigation schemes at every action boundary', () => {
    expect(isSafeScenarioNavigationUrl('/settings')).toBe(true);
    expect(isSafeScenarioNavigationUrl('https://app.example.test/settings')).toBe(true);
    expect(isSafeScenarioNavigationUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeScenarioNavigationUrl('file:///etc/passwd')).toBe(false);
    expect(isSafeScenarioNavigationUrl('//evil.example/path')).toBe(false);
    expect(validateScenario(documentWith([{ do: 'navigate', url: 'data:text/html,pwned' }])).ok).toBe(false);
  });

  it('reports duplicate editor IDs and tags with field-addressable paths', () => {
    const result = validateScenario(
      documentWith(
        [
          { id: 'same', do: 'click', ref: 'one' },
          { id: 'same', assert: 'targetVisible', ref: 'two' },
        ],
        { tags: ['smoke', 'smoke'] },
      ),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'duplicate', path: 'tags[1]' }),
        expect.objectContaining({ code: 'duplicate', path: 'steps[1].id' }),
      ]),
    );
  });

  it('rejects empty documents and mixed action/assertion discriminators', () => {
    expect(validateScenario(documentWith([])).ok).toBe(false);
    expect(
      validateScenario(documentWith([{ do: 'click', assert: 'targetVisible', ref: 'submit' }])).ok,
    ).toBe(false);
  });

  it('provides a throwing parser for trusted domain boundaries', () => {
    expect(() => parseScenario(documentWith([{ do: 'click', ref: 'submit' }]))).not.toThrow();
    expect(() => parseScenario(documentWith([{ do: 'click' }]))).toThrow(ScenarioValidationError);
  });
});

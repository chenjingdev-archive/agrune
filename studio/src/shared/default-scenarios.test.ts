import { describe, expect, it } from 'vitest';
import { DEFAULT_SCENARIOS, DEMO_URL } from './default-scenarios';

describe('default Studio scenarios', () => {
  it('keep scenario and step ids globally unique', () => {
    const scenarioIds = DEFAULT_SCENARIOS.map((scenario) => scenario.id);
    const stepIds = DEFAULT_SCENARIOS.flatMap((scenario) => scenario.steps.map((step) => step.id));

    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    expect(new Set(stepIds).size).toBe(stepIds.length);
  });

  it('starts every demo scenario from the deterministic demo URL', () => {
    for (const scenario of DEFAULT_SCENARIOS.filter(({ id }) => id !== 'naver-weather-search')) {
      expect(scenario.url).toBe(DEMO_URL);
      expect(scenario.manifest).toMatchObject({ schemaVersion: 3, origin: DEMO_URL });
    }
  });

  it('includes a portable Naver weather search scenario with Playwright fallbacks', () => {
    const scenario = DEFAULT_SCENARIOS.find(({ id }) => id === 'naver-weather-search');
    const fallback = {
      by: 'role',
      role: 'combobox',
      name: '검색어를 입력해 주세요',
      exact: false,
    };

    expect(scenario).toMatchObject({
      schema: 'agrune.scenario/v1',
      id: 'naver-weather-search',
      manifest: { schemaVersion: 3 },
      url: 'https://www.naver.com',
      steps: [
        {
          do: 'waitFor',
          ref: 'naver_search_input',
          state: 'visible',
          playwrightFallback: fallback,
        },
        {
          do: 'fill',
          ref: 'naver_search_input',
          value: '서울 날씨',
          playwrightFallback: fallback,
        },
        {
          do: 'press',
          ref: 'naver_search_input',
          key: 'Enter',
          playwrightFallback: fallback,
        },
        { assert: 'urlContains', value: 'search.naver.com/search.naver' },
        { assert: 'titleContains', value: '서울 날씨' },
        { assert: 'textPresent', value: '오늘의 날씨' },
      ],
    });
    expect(scenario?.manifest).not.toHaveProperty('origin');
  });

  it('use manifest targets for every interactive action', () => {
    for (const step of DEFAULT_SCENARIOS.flatMap((scenario) => scenario.steps)) {
      if ('ref' in step) {
        expect(step.ref).toMatch(/^[a-z][a-z0-9_]*(?:\[key=[^\]]+\]\.[a-z][a-z0-9_]*)?$/);
      }
    }
  });
});

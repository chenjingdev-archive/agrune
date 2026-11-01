import type { Locator, Page } from 'playwright';
import { describe, expect, it, vi } from 'vitest';
import type { PlaywrightRecoveryRequest } from '../scenario';
import { recoverScenarioActionWithPlaywright } from './playwright-recovery';

function recoveryRequest(overrides: Partial<PlaywrightRecoveryRequest> = {}): PlaywrightRecoveryRequest {
  const locator = { by: 'role' as const, role: 'combobox', name: 'Search', exact: false };
  return {
    step: {
      do: 'fill',
      ref: 'search_input',
      value: '서울 날씨',
      playwrightFallback: locator,
    },
    locator,
    causeCode: 'MANIFEST_NOT_FOUND',
    causeMessage: 'No manifest',
    fillValue: '서울 날씨',
    ...overrides,
  } as PlaywrightRecoveryRequest;
}

function pageHarness(options: { count?: number; type?: string | null; autocomplete?: string | null } = {}) {
  const actions = {
    waitFor: vi.fn(async () => undefined),
    count: vi.fn(async () => options.count ?? 1),
    getAttribute: vi.fn(async (name: string) => {
      if (name === 'type') return options.type ?? null;
      if (name === 'autocomplete') return options.autocomplete ?? null;
      return null;
    }),
    isEnabled: vi.fn(async () => true),
    fill: vi.fn(async () => undefined),
    click: vi.fn(async () => undefined),
    dblclick: vi.fn(async () => undefined),
    hover: vi.fn(async () => undefined),
    focus: vi.fn(async () => undefined),
    pressSequentially: vi.fn(async () => undefined),
    press: vi.fn(async () => undefined),
    selectOption: vi.fn(async () => []),
    check: vi.fn(async () => undefined),
    uncheck: vi.fn(async () => undefined),
  };
  const locator = {
    ...actions,
    first: () => locator,
  } as unknown as Locator;
  const getByRole = vi.fn(() => locator);
  const page = {
    getByRole,
    getByLabel: vi.fn(() => locator),
    getByPlaceholder: vi.fn(() => locator),
    getByTestId: vi.fn(() => locator),
    waitForTimeout: vi.fn(async () => undefined),
    keyboard: { insertText: vi.fn(async () => undefined) },
  } as unknown as Page;
  return { page, locator, actions, getByRole };
}

describe('Playwright recovery host', () => {
  it('uses one structured role candidate and executes the original fill semantics', async () => {
    const harness = pageHarness();
    const result = await recoverScenarioActionWithPlaywright(harness.page, recoveryRequest());

    expect(harness.getByRole).toHaveBeenCalledWith('combobox', { name: 'Search', exact: false });
    expect(harness.actions.fill).toHaveBeenNthCalledWith(1, '', { timeout: 10_000 });
    expect(harness.actions.fill).toHaveBeenNthCalledWith(2, '서울 날씨', { timeout: 10_000 });
    expect(result).toMatchObject({ matchCount: 1, changed: true });
  });

  it('reports ambiguity without invoking the browser action', async () => {
    const harness = pageHarness({ count: 2 });
    const request = recoveryRequest({
      step: {
        do: 'click',
        ref: 'submit_button',
        playwrightFallback: { by: 'role', role: 'button', name: 'Submit' },
      },
      locator: { by: 'role', role: 'button', name: 'Submit' },
      fillValue: undefined,
    });

    await expect(recoverScenarioActionWithPlaywright(harness.page, request)).resolves.toMatchObject({ matchCount: 2 });
    expect(harness.actions.click).not.toHaveBeenCalled();
  });

  it('fails closed when a literal fill resolves to a password input', async () => {
    const harness = pageHarness({ type: 'password' });

    await expect(recoverScenarioActionWithPlaywright(harness.page, recoveryRequest()))
      .rejects.toThrow('disabled for password');
    expect(harness.actions.fill).not.toHaveBeenCalled();
  });
});

import type { Locator, Page } from 'playwright';
import type {
  PlaywrightFallbackLocator,
  PlaywrightRecoveryRequest,
  PlaywrightRecoveryResult,
} from '../scenario';

const DEFAULT_RECOVERY_TIMEOUT_MS = 10_000;
const LONG_PRESS_DELAY_MS = 650;
const SENSITIVE_AUTOCOMPLETE_TOKENS = new Set([
  'current-password',
  'new-password',
  'one-time-code',
  'cc-number',
  'cc-csc',
]);

type PlaywrightRole = Parameters<Page['getByRole']>[0];

function locatorFor(page: Page, hint: PlaywrightFallbackLocator): Locator {
  const exact = hint.exact ?? true;
  switch (hint.by) {
    case 'role':
      return page.getByRole(hint.role as PlaywrightRole, { name: hint.name, exact });
    case 'label':
      return page.getByLabel(hint.name, { exact });
    case 'placeholder':
      return page.getByPlaceholder(hint.name, { exact });
    case 'testId':
      return page.getByTestId(hint.name);
  }
}

export function describePlaywrightFallback(hint: PlaywrightFallbackLocator): string {
  const exact = hint.exact ?? true;
  switch (hint.by) {
    case 'role':
      return `getByRole(${JSON.stringify(hint.role)}, { name: ${JSON.stringify(hint.name)}, exact: ${exact} })`;
    case 'label':
      return `getByLabel(${JSON.stringify(hint.name)}, { exact: ${exact} })`;
    case 'placeholder':
      return `getByPlaceholder(${JSON.stringify(hint.name)}, { exact: ${exact} })`;
    case 'testId':
      return `getByTestId(${JSON.stringify(hint.name)})`;
  }
}

function recoveryTimeout(request: PlaywrightRecoveryRequest): number {
  return request.step.do === 'waitFor'
    ? request.step.timeoutMs ?? DEFAULT_RECOVERY_TIMEOUT_MS
    : DEFAULT_RECOVERY_TIMEOUT_MS;
}

async function rejectSensitiveInput(locator: Locator): Promise<void> {
  const type = (await locator.getAttribute('type'))?.trim().toLowerCase();
  const autocomplete = (await locator.getAttribute('autocomplete'))?.trim().toLowerCase() ?? '';
  const autocompleteTokens = autocomplete.split(/\s+/).filter(Boolean);
  if (type === 'password' || autocompleteTokens.some((token) => SENSITIVE_AUTOCOMPLETE_TOKENS.has(token))) {
    throw new Error('Playwright recovery is disabled for password, one-time-code, and payment credential inputs.');
  }
}

async function requireEnabled(locator: Locator): Promise<void> {
  if (!(await locator.isEnabled())) {
    throw new Error('Playwright recovery found one element, but it is disabled.');
  }
}

async function waitForEnabledState(
  page: Page,
  locator: Locator,
  enabled: boolean,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    if ((await locator.isEnabled()) === enabled) return;
    await page.waitForTimeout(100);
  }
  throw new Error(`Playwright recovery timed out waiting for the element to become ${enabled ? 'enabled' : 'disabled'}.`);
}

/**
 * Execute a scenario's already-declared semantic action through a closed set
 * of Playwright accessibility locators. The manifest lookup has already failed
 * before this boundary is called; this function never accepts CSS/XPath/JS.
 */
export async function recoverScenarioActionWithPlaywright(
  page: Page,
  request: PlaywrightRecoveryRequest,
): Promise<PlaywrightRecoveryResult> {
  const locator = locatorFor(page, request.locator);
  const description = describePlaywrightFallback(request.locator);
  const timeout = recoveryTimeout(request);
  const step = request.step;

  // Waiting for the first candidate avoids racing a still-loading page. The
  // count is checked afterwards and the action is never attempted if the hint
  // is ambiguous.
  await locator.first().waitFor({
    state: step.do === 'waitFor' && step.state === 'hidden' ? 'attached' : 'visible',
    timeout,
  });
  const matchCount = await locator.count();
  if (matchCount !== 1) return { description, matchCount };

  switch (step.do) {
    case 'click':
      await requireEnabled(locator);
      await locator.click({ timeout });
      return { description, matchCount, changed: true };
    case 'dblclick':
      await requireEnabled(locator);
      await locator.dblclick({ timeout });
      return { description, matchCount, changed: true };
    case 'contextmenu':
      await requireEnabled(locator);
      await locator.click({ button: 'right', timeout });
      return { description, matchCount, changed: true };
    case 'hover':
      await locator.hover({ timeout });
      return { description, matchCount, changed: false };
    case 'longpress':
      await requireEnabled(locator);
      await locator.click({ delay: LONG_PRESS_DELAY_MS, timeout });
      return { description, matchCount, changed: true };
    case 'fill': {
      await rejectSensitiveInput(locator);
      await requireEnabled(locator);
      const value = request.fillValue;
      if (value === undefined) throw new Error('Playwright fill recovery did not receive a value.');
      const clear = step.clear ?? true;
      const strategy = step.strategy ?? 'auto';
      if (clear) await locator.fill('', { timeout });
      if (strategy === 'insert') {
        await locator.focus({ timeout });
        await page.keyboard.insertText(value);
      } else if (strategy === 'keystroke' || !clear) {
        await locator.pressSequentially(value, { timeout });
      } else {
        await locator.fill(value, { timeout });
      }
      return { description, matchCount, changed: true };
    }
    case 'type':
      await rejectSensitiveInput(locator);
      await requireEnabled(locator);
      await locator.pressSequentially(step.text, { delay: step.delayMs, timeout });
      if (step.submit) await locator.press('Enter', { timeout });
      return { description, matchCount, changed: true };
    case 'press':
      await requireEnabled(locator);
      await locator.press(step.key, { delay: step.delayMs, timeout });
      return { description, matchCount, changed: true };
    case 'select':
      await requireEnabled(locator);
      await locator.selectOption(step.value, { timeout });
      return { description, matchCount, changed: true };
    case 'check':
      await requireEnabled(locator);
      await locator.check({ timeout });
      return { description, matchCount, changed: true };
    case 'uncheck':
      await requireEnabled(locator);
      await locator.uncheck({ timeout });
      return { description, matchCount, changed: true };
    case 'waitFor':
      if (step.state === 'visible' || step.state === 'hidden') {
        await locator.waitFor({ state: step.state, timeout });
      } else {
        await waitForEnabledState(page, locator, step.state === 'enabled', timeout);
      }
      return { description, matchCount, changed: false };
  }
}

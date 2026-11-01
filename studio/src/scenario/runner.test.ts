import type { BrowserSession } from 'agrune';
import { describe, expect, it } from 'vitest';
import {
  SCENARIO_SCHEMA_ID,
  evaluateScenarioAssertion,
  runScenario,
  type Scenario,
  type PlaywrightRecoveryRequest,
  type ScenarioRuntime,
  type ScenarioRuntimeConsoleMessage,
  type ScenarioRuntimeNetworkRequest,
  type ScenarioRuntimeSnapshot,
  type ScenarioRuntimeTab,
} from './index';

type Assert<T extends true> = T;
type BrowserSessionIsCompatible = Assert<BrowserSession extends ScenarioRuntime ? true : false>;
const browserSessionCompatibility: BrowserSessionIsCompatible = true;

class FakeRuntime implements ScenarioRuntime {
  private tabs: ScenarioRuntimeTab[] = [];
  readonly calls: Array<{ name: string; args: unknown[] }> = [];
  readonly fills: Array<{ ref: string; value: string }> = [];
  consoleEntries: ScenarioRuntimeConsoleMessage[] = [];
  networkEntries: ScenarioRuntimeNetworkRequest[] = [];
  bodyText = 'Welcome, Alice';
  title = 'Agrune Demo';
  failSecretFill = false;
  actionFailure: unknown;
  snapshotValue: ScenarioRuntimeSnapshot = {
    schemaVersion: 3,
    url: 'https://app.example.test/',
    title: 'Agrune Demo',
    targets: [
      { targetId: 'login.email', visible: true, enabled: true },
      { targetId: 'login.password', visible: true, enabled: true, sensitive: true },
      { targetId: 'login.submit', visible: true, enabled: true },
      {
        targetId: 'members__agrune_repeatKey_user-1.open_profile',
        visible: true,
        enabled: true,
        repeatInstance: { repeatId: 'members', index: 0, key: 'user-1' },
      },
      {
        targetId: 'members__agrune_repeatKey_user-2.open_profile',
        visible: false,
        enabled: false,
        repeatInstance: { repeatId: 'members', index: 1, key: 'user-2' },
      },
    ],
  };

  get tabCount(): number {
    return this.tabs.length;
  }

  async open(url: string): Promise<void> {
    this.calls.push({ name: 'open', args: [url] });
    this.tabs = [{ tabId: 1, index: 0, url, title: this.title, active: true }];
    this.snapshotValue = { ...this.snapshotValue, url, title: this.title };
  }

  async navigate(url: string): Promise<void> {
    this.calls.push({ name: 'navigate', args: [url] });
    if (this.tabs.length === 0) throw new Error('No tab');
    this.tabs[0] = { ...this.tabs[0]!, url, title: this.title };
    this.snapshotValue = { ...this.snapshotValue, url, title: this.title };
  }

  async listTabs(): Promise<ScenarioRuntimeTab[]> {
    return this.tabs.map((tab) => ({ ...tab }));
  }

  async snapshot(): Promise<ScenarioRuntimeSnapshot> {
    if (this.tabs.length === 0) throw new Error('No tab');
    return this.snapshotValue;
  }

  async click(_tabId: number | undefined, ref: string, action = 'click'): Promise<{ changed: boolean }> {
    this.calls.push({ name: action, args: [ref] });
    if (this.actionFailure !== undefined) throw this.actionFailure;
    return { changed: true };
  }

  async fill(
    _tabId: number | undefined,
    ref: string,
    value: string,
    clear = true,
    strategy: 'auto' | 'insert' | 'keystroke' = 'auto',
  ): Promise<{ changed: boolean }> {
    this.fills.push({ ref, value });
    this.calls.push({ name: 'fill', args: [ref, clear, strategy] });
    if (this.failSecretFill) throw new Error(`Playwright locator.fill(${JSON.stringify(value)}) failed`);
    if (this.actionFailure !== undefined) throw this.actionFailure;
    return { changed: true };
  }

  async type(_tabId: number | undefined, ref: string, text: string, delayMs?: number, submit?: boolean): Promise<void> {
    this.calls.push({ name: 'type', args: [ref, text, delayMs, submit] });
  }

  async press(_tabId: number | undefined, key: string, ref?: string, delayMs?: number): Promise<void> {
    this.calls.push({ name: 'press', args: [key, ref, delayMs] });
  }

  async select(_tabId: number | undefined, ref: string, values: Array<{ value: string }>): Promise<void> {
    this.calls.push({ name: 'select', args: [ref, values] });
  }

  async check(_tabId: number | undefined, ref: string): Promise<void> {
    this.calls.push({ name: 'check', args: [ref] });
  }

  async uncheck(_tabId: number | undefined, ref: string): Promise<void> {
    this.calls.push({ name: 'uncheck', args: [ref] });
  }

  async waitForTarget(
    _tabId: number | undefined,
    ref: string,
    state: 'visible' | 'hidden' | 'enabled' | 'disabled',
    timeoutMs?: number,
  ): Promise<void> {
    this.calls.push({ name: 'waitForTarget', args: [ref, state, timeoutMs] });
  }

  async waitForTime(_tabId: number | undefined, ms: number): Promise<void> {
    this.calls.push({ name: 'waitForTime', args: [ms] });
  }

  async read(): Promise<string> {
    return this.bodyText;
  }

  consoleMessages(): ScenarioRuntimeConsoleMessage[] {
    return [...this.consoleEntries];
  }

  networkRequests(): ScenarioRuntimeNetworkRequest[] {
    return [...this.networkEntries];
  }
}

function scenarioWith(steps: Scenario['steps'], overrides: Partial<Scenario> = {}): Scenario {
  return {
    schema: SCENARIO_SCHEMA_ID,
    id: 'login-smoke',
    name: 'Login smoke',
    manifest: { schemaVersion: 3, origin: 'https://app.example.test' },
    url: 'https://app.example.test/login',
    steps,
    ...overrides,
  };
}

function codedError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('scenario runner', () => {
  it('is structurally compatible with the current public BrowserSession API', () => {
    expect(browserSessionCompatibility).toBe(true);
  });

  it('runs manifest actions and independent assertions end to end', async () => {
    const runtime = new FakeRuntime();
    runtime.networkEntries = [
      { method: 'POST', url: 'https://app.example.test/api/session', timestamp: 101, status: 201 },
    ];
    let tick = 100;
    const report = await runScenario(
      runtime,
      scenarioWith([
        { do: 'fill', ref: 'login.email', value: 'qa@example.com' },
        { do: 'fill', ref: 'login.password', secretRef: 'qa.password' },
        { do: 'click', ref: 'login.submit' },
        { assert: 'textPresent', value: 'Welcome, Alice' },
        { assert: 'networkStatus', method: 'POST', urlContains: '/api/session', status: 201 },
        { assert: 'targetVisible', ref: 'login.submit' },
      ]),
      { resolveSecret: async () => 'top-secret-runtime-value', now: () => tick++ },
    );

    expect(report.status).toBe('passed');
    expect(report.passed).toBe(6);
    expect(report.failed).toBe(0);
    expect(runtime.fills).toEqual([
      { ref: 'login.email', value: 'qa@example.com' },
      { ref: 'login.password', value: 'top-secret-runtime-value' },
    ]);
    expect(JSON.stringify(report)).not.toContain('top-secret-runtime-value');
    expect(report.steps[2]).toMatchObject({ status: 'passed', changed: true, targetRef: 'login.submit' });
  });

  it.each(['MANIFEST_NOT_FOUND', 'TARGET_NOT_FOUND'] as const)(
    'uses a Playwright fallback only after the manifest action reports %s',
    async (causeCode) => {
      const runtime = new FakeRuntime();
      runtime.actionFailure = codedError(causeCode, `manifest path failed: ${causeCode}`);
      const requests: PlaywrightRecoveryRequest[] = [];

      const report = await runScenario(
        runtime,
        scenarioWith([{
          do: 'click',
          ref: 'login.submit',
          playwrightFallback: { by: 'role', role: 'button', name: 'Sign in', exact: true },
        }]),
        {
          recoverWithPlaywright: async (request) => {
            // The normal manifest-backed runtime call must always happen first.
            expect(runtime.calls).toContainEqual({ name: 'click', args: ['login.submit'] });
            requests.push(request);
            return { description: 'getByRole("button", { name: "Sign in", exact: true })', matchCount: 1, changed: true };
          },
        },
      );

      expect(report.status).toBe('passed');
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        causeCode,
        locator: { by: 'role', role: 'button', name: 'Sign in', exact: true },
        step: { do: 'click', ref: 'login.submit' },
      });
      expect(report.steps[0]).toMatchObject({
        status: 'passed',
        changed: true,
        recovery: {
          engine: 'playwright',
          causeCode,
          description: 'getByRole("button", { name: "Sign in", exact: true })',
          matchCount: 1,
        },
      });
    },
  );

  it('passes only a literal fill value to Playwright recovery', async () => {
    const runtime = new FakeRuntime();
    runtime.actionFailure = codedError('MANIFEST_NOT_FOUND');
    let request: PlaywrightRecoveryRequest | undefined;
    const report = await runScenario(
      runtime,
      scenarioWith([{
        do: 'fill',
        ref: 'search.input',
        value: '서울 날씨',
        playwrightFallback: { by: 'placeholder', name: '검색어를 입력해 주세요', exact: true },
      }]),
      {
        recoverWithPlaywright: async (next) => {
          request = next;
          return { description: 'getByPlaceholder("검색어를 입력해 주세요")', matchCount: 1 };
        },
      },
    );

    expect(report.status).toBe('passed');
    expect(request?.fillValue).toBe('서울 날씨');
  });

  it('never invokes recovery for generic failures or when the step has no fallback', async () => {
    let recoveryCalls = 0;
    const recoverWithPlaywright = async () => {
      recoveryCalls += 1;
      return { description: 'should not run', matchCount: 1 };
    };

    const genericRuntime = new FakeRuntime();
    genericRuntime.actionFailure = new Error('Playwright click timed out');
    const generic = await runScenario(
      genericRuntime,
      scenarioWith([{
        do: 'click',
        ref: 'login.submit',
        playwrightFallback: { by: 'testId', name: 'submit' },
      }]),
      { recoverWithPlaywright },
    );

    const otherCodeRuntime = new FakeRuntime();
    otherCodeRuntime.actionFailure = codedError('TIMEOUT', 'TARGET_NOT_FOUND appears only in the message');
    const otherCode = await runScenario(
      otherCodeRuntime,
      scenarioWith([{
        do: 'click',
        ref: 'login.submit',
        playwrightFallback: { by: 'testId', name: 'submit' },
      }]),
      { recoverWithPlaywright },
    );

    const noFallbackRuntime = new FakeRuntime();
    noFallbackRuntime.actionFailure = codedError('TARGET_NOT_FOUND');
    const noFallback = await runScenario(
      noFallbackRuntime,
      scenarioWith([{ do: 'click', ref: 'login.submit' }]),
      { recoverWithPlaywright },
    );

    expect([generic.status, otherCode.status, noFallback.status]).toEqual(['failed', 'failed', 'failed']);
    expect(recoveryCalls).toBe(0);
  });

  it('fails closed when Playwright recovery is ambiguous', async () => {
    const runtime = new FakeRuntime();
    runtime.actionFailure = codedError('TARGET_NOT_FOUND');
    const report = await runScenario(
      runtime,
      scenarioWith([{
        do: 'click',
        ref: 'login.submit',
        playwrightFallback: { by: 'label', name: 'Submit' },
      }]),
      {
        recoverWithPlaywright: async () => ({ description: 'getByLabel("Submit")', matchCount: 2 }),
      },
    );

    expect(report.status).toBe('failed');
    expect(report.steps[0]?.error).toMatchObject({ code: 'ACTION_FAILED' });
    expect(report.steps[0]?.error?.message).toContain('exactly one is required');
    expect(report.steps[0]?.recovery).toBeUndefined();
  });

  it('suppresses runtime details that may echo a resolved secret', async () => {
    const runtime = new FakeRuntime();
    runtime.failSecretFill = true;
    const report = await runScenario(
      runtime,
      scenarioWith([{ do: 'fill', ref: 'login.password', secretRef: 'qa.password' }]),
      { resolveSecret: () => 'top-secret-runtime-value' },
    );

    expect(report.status).toBe('failed');
    expect(report.steps[0]?.error).toMatchObject({ code: 'ACTION_FAILED' });
    expect(JSON.stringify(report)).not.toContain('top-secret-runtime-value');
    expect(report.steps[0]?.error?.message).toContain('runtime detail was suppressed');
  });

  it('requires secretRef for a manifest-sensitive fill and suppresses resolver failures', async () => {
    const inlineRuntime = new FakeRuntime();
    const inline = await runScenario(
      inlineRuntime,
      scenarioWith([{ do: 'fill', ref: 'login.password', value: 'must-not-be-inline' }]),
    );
    expect(inline.steps[0]?.error?.code).toBe('SECRET_REQUIRED');
    expect(inlineRuntime.fills).toEqual([]);

    const resolverFailure = await runScenario(
      new FakeRuntime(),
      scenarioWith([{ do: 'fill', ref: 'login.password', secretRef: 'qa.password' }]),
      { resolveSecret: () => { throw new Error('vault accidentally echoed top-secret-runtime-value'); } },
    );
    expect(resolverFailure.steps[0]?.error?.code).toBe('SECRET_RESOLUTION_FAILED');
    expect(JSON.stringify(resolverFailure)).not.toContain('top-secret-runtime-value');
  });

  it('stops at the first failure and marks remaining steps skipped', async () => {
    const runtime = new FakeRuntime();
    const report = await runScenario(
      runtime,
      scenarioWith([
        { assert: 'textPresent', value: 'Not on this page' },
        { do: 'click', ref: 'login.submit' },
      ]),
    );

    expect(report.status).toBe('failed');
    expect(report.failed).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.steps.map((step) => step.status)).toEqual(['failed', 'skipped']);
    expect(runtime.calls.some((call) => call.name === 'click')).toBe(false);
  });

  it('requires an explicit host verifier for an appVersion pin', async () => {
    const runtime = new FakeRuntime();
    const pinned = scenarioWith([{ assert: 'noConsoleErrors' }], {
      manifest: { schemaVersion: 3, origin: 'https://app.example.test', appVersion: '2026.08' },
    });
    const unverified = await runScenario(runtime, pinned);
    expect(unverified.status).toBe('failed');
    expect(unverified.error?.code).toBe('MANIFEST_PIN_UNVERIFIABLE');

    const verified = await runScenario(new FakeRuntime(), pinned, {
      verifyManifestPin: ({ pin }) =>
        pin.appVersion === '2026.08' ? { ok: true } : { ok: false, message: 'Unexpected app version.' },
    });
    expect(verified.status).toBe('passed');
  });

  it('resolves relative navigation against the active page', async () => {
    const runtime = new FakeRuntime();
    const report = await runScenario(
      runtime,
      scenarioWith([
        { do: 'navigate', url: '../settings?tab=profile' },
        { assert: 'urlEquals', value: 'https://app.example.test/settings?tab=profile' },
      ]),
    );
    expect(report.status).toBe('passed');
    expect(runtime.calls).toContainEqual({
      name: 'navigate',
      args: ['https://app.example.test/settings?tab=profile'],
    });
  });

  it('matches repeated targets by canonical agent ref and counts unique instances', async () => {
    const runtime = new FakeRuntime();
    await runtime.open('https://app.example.test/');
    await expect(
      evaluateScenarioAssertion(runtime, {
        assert: 'targetVisible',
        ref: 'members[key=user-1].open_profile',
      }),
    ).resolves.toBeUndefined();
    await expect(
      evaluateScenarioAssertion(runtime, { assert: 'targetCount', repeat: 'members', count: 2 }),
    ).resolves.toBeUndefined();
  });

  it('cooperatively cancels between steps and isolates observer failures', async () => {
    const controller = new AbortController();
    controller.abort();
    const cancelled = await runScenario(
      new FakeRuntime(),
      scenarioWith([{ do: 'click', ref: 'login.submit' }]),
      { signal: controller.signal },
    );
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.skipped).toBe(1);

    const observed = await runScenario(
      new FakeRuntime(),
      scenarioWith([{ assert: 'noConsoleErrors' }]),
      { onEvent: () => { throw new Error('timeline disconnected'); } },
    );
    expect(observed.status).toBe('passed');
    expect(observed.observerErrors.length).toBeGreaterThan(0);
    expect(observed.observerErrors[0]).toContain('timeline disconnected');
  });
});

import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import { validateScenario } from '../src/scenario';
import {
  JsonRecentWorkspacePersistence,
  ScenarioStore,
  WorkspaceError,
  WorkspaceStore,
  createWorkspaceConfig,
  readWorkspaceConfig,
  resolveWorkspacePath,
  writeWorkspaceConfig,
  type AgruneScenario,
} from '../src/workspace';

const roots: string[] = [];

async function workspaceRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'agrune-studio-workspace-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  // Test-owned temporary directories only. Production persistence exposes no deletion API.
  const { rm } = await import('node:fs/promises');
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function sampleScenario(name = 'Checkout'): AgruneScenario {
  return {
    schema: 'agrune.scenario/v1',
    name,
    manifest: { schemaVersion: 3 },
    steps: [
      { do: 'navigate', url: 'http://127.0.0.1:4178' },
      { do: 'fill', ref: 'checkout.email', value: 'test@example.com' },
      { do: 'click', ref: 'checkout.submit' },
      { assert: 'urlContains', value: '/complete' },
    ],
  };
}

describe('workspace config persistence', () => {
  it('round-trips a versioned config with workspace-relative storage paths', async () => {
    const root = await workspaceRoot();
    const config = createWorkspaceConfig({ root, baseUrl: 'http://127.0.0.1:4178' });

    await writeWorkspaceConfig(config);

    await expect(readWorkspaceConfig(root)).resolves.toEqual(config);
    expect(JSON.parse(await readFile(path.join(root, '.agrune/workspace.json'), 'utf8'))).toMatchObject({
      schema: 'agrune.workspace/v1',
      root,
      manifestPath: 'manifest.json',
      scenarioDir: path.normalize('.agrune/scenarios'),
      artifactDir: path.normalize('.agrune/artifacts'),
    });
  });

  it('rejects lexical traversal and absolute child paths', async () => {
    const root = await workspaceRoot();
    expect(() => resolveWorkspacePath(root, '../escape.json')).toThrowError(WorkspaceError);
    expect(() => resolveWorkspacePath(root, path.join(root, 'absolute.json'))).toThrowError(WorkspaceError);
  });

  it('rejects a scenario directory symlinked outside the workspace', async () => {
    const root = await workspaceRoot();
    const outside = await workspaceRoot();
    await mkdir(path.join(root, '.agrune'), { recursive: true });
    await symlink(outside, path.join(root, '.agrune/scenarios'));
    const store = new ScenarioStore(createWorkspaceConfig({ root, baseUrl: 'https://example.test' }));

    await expect(store.write('escape.json', sampleScenario())).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
  });

  it('keeps artifact paths inside the configured artifact directory', async () => {
    const root = await workspaceRoot();
    const store = new WorkspaceStore(createWorkspaceConfig({ root, baseUrl: 'https://example.test' }));

    await expect(store.artifactPath('../manifest.json')).rejects.toMatchObject({ code: 'PATH_OUTSIDE_WORKSPACE' });
    await expect(store.artifactPath('runs/first/trace.zip')).resolves.toBe(
      path.join(root, '.agrune/artifacts/runs/first/trace.zip'),
    );
  });
});

describe('Agrune scenario persistence', () => {
  it('writes atomically, reads, and lists valid nested JSON scenarios', async () => {
    const root = await workspaceRoot();
    const store = new ScenarioStore(createWorkspaceConfig({ root, baseUrl: 'https://example.test' }));

    await store.write('checkout/happy-path.json', sampleScenario());

    await expect(store.read('checkout/happy-path.json')).resolves.toMatchObject({
      path: 'checkout/happy-path.json',
      scenario: { name: 'Checkout' },
    });
    await expect(store.list()).resolves.toEqual([
      expect.objectContaining({ path: 'checkout/happy-path.json', valid: true, name: 'Checkout', stepCount: 4 }),
    ]);
    const scenarioDirectory = path.join(root, '.agrune/scenarios/checkout');
    const files = await import('node:fs/promises').then((fs) => fs.readdir(scenarioDirectory));
    expect(files).toEqual(['happy-path.json']);
  });

  it('does not replace an existing scenario when validation fails', async () => {
    const root = await workspaceRoot();
    const store = new ScenarioStore(createWorkspaceConfig({ root, baseUrl: 'https://example.test' }));
    await store.write('flow.json', sampleScenario('Original'));

    const invalid = { ...sampleScenario('Invalid'), steps: [{ do: 'eval', code: 'process.exit(1)' }] };
    await expect(store.write('flow.json', invalid as unknown as AgruneScenario)).rejects.toMatchObject({
      code: 'INVALID_SCENARIO',
    });
    await expect(store.read('flow.json')).resolves.toMatchObject({ scenario: { name: 'Original' } });
  });

  it('keeps scenario filenames inside the configured scenario directory', async () => {
    const root = await workspaceRoot();
    const store = new ScenarioStore(createWorkspaceConfig({ root, baseUrl: 'https://example.test' }));

    await expect(store.write('../outside.json', sampleScenario())).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
    await expect(store.read(path.join(root, 'absolute.json'))).rejects.toMatchObject({
      code: 'PATH_OUTSIDE_WORKSPACE',
    });
  });

  it('surfaces invalid JSON and validation errors in listings', async () => {
    const root = await workspaceRoot();
    const config = createWorkspaceConfig({ root, baseUrl: 'https://example.test' });
    const scenarioDir = path.join(root, config.scenarioDir);
    await mkdir(scenarioDir, { recursive: true });
    await writeFile(path.join(scenarioDir, 'broken.json'), '{ nope', 'utf8');
    await writeFile(
      path.join(scenarioDir, 'unsafe.json'),
      JSON.stringify({ ...sampleScenario(), steps: [{ assert: 'evalExpression', value: 'window.secret' }] }),
      'utf8',
    );

    const listing = await new ScenarioStore(config).list();
    expect(listing).toHaveLength(2);
    expect(listing.every((entry) => !entry.valid)).toBe(true);
    expect(listing.find((entry) => entry.path === 'unsafe.json')?.errors).toContainEqual(
      expect.objectContaining({ path: 'steps[0].assert', code: 'invalid_value' }),
    );
  });

  it('keeps fill secrets mutually exclusive and assertions closed', () => {
    expect(
      validateScenario({
        ...sampleScenario(),
        steps: [{ do: 'fill', ref: 'password', value: 'plaintext', secretRef: 'vault-key' }],
      }),
    ).toMatchObject({ ok: false });
    expect(
      validateScenario({ ...sampleScenario(), steps: [{ assert: 'evalExpression', value: 'document.cookie' }] }),
    ).toMatchObject({ ok: false });
  });
});

describe('recent workspace persistence', () => {
  it('deduplicates by root and orders the most recently opened workspace first', async () => {
    const storageRoot = await workspaceRoot();
    const firstRoot = await workspaceRoot();
    const secondRoot = await workspaceRoot();
    const recents = new JsonRecentWorkspacePersistence(path.join(storageRoot, 'recents.json'));
    const first = createWorkspaceConfig({ root: firstRoot, baseUrl: 'https://first.test' });
    const second = createWorkspaceConfig({ root: secondRoot, baseUrl: 'https://second.test' });

    await recents.record(first, new Date('2026-08-01T00:00:00.000Z'));
    await recents.record(second, new Date('2026-08-02T00:00:00.000Z'));
    await recents.record(first, new Date('2026-08-03T00:00:00.000Z'));

    await expect(recents.list()).resolves.toEqual([
      { root: firstRoot, baseUrl: 'https://first.test', lastOpenedAt: '2026-08-03T00:00:00.000Z' },
      { root: secondRoot, baseUrl: 'https://second.test', lastOpenedAt: '2026-08-02T00:00:00.000Z' },
    ]);
  });
});

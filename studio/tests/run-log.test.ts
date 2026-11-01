import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeRunLog } from '../src/main/run-log';

const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'agrune-run-log-'));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('run log persistence', () => {
  it('creates nested directories and writes a private JSON document', async () => {
    const root = await temporaryRoot();
    const runJsonPath = path.join(root, '.agrune/artifacts/runs/run-123/run.json');
    const document = {
      schema: 'agrune.run-log/v1',
      runId: 'run-123',
      status: 'failed',
      timeline: [{ title: 'Submit failed', timestamp: 123 }],
      diagnostics: { console: [], network: [{ method: 'POST', status: 500 }] },
    };

    await writeRunLog(runJsonPath, document);

    expect(JSON.parse(await readFile(runJsonPath, 'utf8'))).toEqual(document);
    expect(await readFile(runJsonPath, 'utf8')).toMatch(/\n$/);
    if (process.platform !== 'win32') {
      expect((await stat(runJsonPath)).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(path.dirname(runJsonPath))).toEqual(['run.json']);
  });

  it('atomically replaces an existing log and restores its final mode to 0600', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'runs/run-456');
    const runJsonPath = path.join(directory, 'run.json');
    await mkdir(directory, { recursive: true });
    await writeFile(runJsonPath, '{"status":"running"}\n', { mode: 0o644 });
    if (process.platform !== 'win32') await chmod(runJsonPath, 0o644);

    await writeRunLog(runJsonPath, { runId: 'run-456', status: 'passed' });

    await expect(readFile(runJsonPath, 'utf8')).resolves.toContain('"status": "passed"');
    if (process.platform !== 'win32') {
      expect((await stat(runJsonPath)).mode & 0o777).toBe(0o600);
    }
    expect(await readdir(directory)).toEqual(['run.json']);
  });

  it('removes its sibling temporary file when the final rename fails', async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, 'runs/run-blocked');
    const runJsonPath = path.join(directory, 'run.json');
    await mkdir(runJsonPath, { recursive: true });
    await writeFile(path.join(runJsonPath, 'keep.txt'), 'destination directory', 'utf8');

    await expect(writeRunLog(runJsonPath, { status: 'failed' })).rejects.toBeTruthy();

    expect(await readdir(directory)).toEqual(['run.json']);
    expect(await readdir(runJsonPath)).toEqual(['keep.txt']);
  });

  it('rejects non-run.json destinations and unserializable documents before writing', async () => {
    const root = await temporaryRoot();
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await expect(writeRunLog(path.join(root, 'other.json'), {})).rejects.toThrow('must end in run.json');
    await expect(writeRunLog(path.join(root, 'run.json'), circular)).rejects.toThrow('must be JSON serializable');
    await expect(readdir(root)).resolves.toEqual([]);
  });
});

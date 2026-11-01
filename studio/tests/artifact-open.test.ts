import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveArtifactFile } from '../src/main/artifact-open';

const roots: string[] = [];

async function makeRoot(label: string): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), `agrune-artifact-${label}-`));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('artifact open path validation', () => {
  it('accepts an existing regular file in the current artifact directory', async () => {
    const root = await makeRoot('valid');
    const artifactDir = path.join(root, '.agrune/artifacts');
    const file = path.join(artifactDir, 'runs/one/run.json');
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, '{}', 'utf8');

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: file,
    })).resolves.toBe(await import('node:fs/promises').then((fs) => fs.realpath(file)));
  });

  it('rejects lexical traversal outside the artifact directory', async () => {
    const root = await makeRoot('boundary');
    const artifactDir = path.join(root, '.agrune/artifacts');
    const outside = path.join(root, 'manifest.json');
    await mkdir(artifactDir, { recursive: true });
    await writeFile(outside, '{}', 'utf8');

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: outside,
    })).rejects.toThrow('outside the current artifact directory');
  });

  it('rejects a missing file', async () => {
    const root = await makeRoot('missing');
    const artifactDir = path.join(root, '.agrune/artifacts');
    await mkdir(artifactDir, { recursive: true });

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: path.join(artifactDir, 'missing.json'),
    })).rejects.toThrow('does not exist');
  });

  it('rejects a directory in place of an artifact file', async () => {
    const root = await makeRoot('directory');
    const directory = path.join(root, '.agrune/artifacts/runs');
    await mkdir(directory, { recursive: true });

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: directory,
    })).rejects.toThrow('not a regular file');
  });

  it('rejects a file reached through a symlink that escapes the artifact directory', async () => {
    const root = await makeRoot('symlink');
    const outsideRoot = await makeRoot('outside');
    const artifactDir = path.join(root, '.agrune/artifacts');
    const outsideFile = path.join(outsideRoot, 'secret.json');
    const linkedFile = path.join(artifactDir, 'linked.json');
    await mkdir(artifactDir, { recursive: true });
    await writeFile(outsideFile, '{}', 'utf8');
    await symlink(outsideFile, linkedFile);

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: linkedFile,
    })).rejects.toThrow('resolves outside the current artifact directory');
  });

  it('rejects an artifact directory symlinked outside the workspace', async () => {
    const root = await makeRoot('root-symlink');
    const outsideRoot = await makeRoot('artifact-root-outside');
    const outsideFile = path.join(outsideRoot, 'run.json');
    await mkdir(path.join(root, '.agrune'), { recursive: true });
    await writeFile(outsideFile, '{}', 'utf8');
    await symlink(outsideRoot, path.join(root, '.agrune/artifacts'));

    await expect(resolveArtifactFile({
      workspaceRoot: root,
      artifactDir: '.agrune/artifacts',
      candidatePath: path.join(root, '.agrune/artifacts/run.json'),
    })).rejects.toThrow('artifact directory resolves outside the current workspace');
  });
});

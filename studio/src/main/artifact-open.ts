import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ResolveArtifactFileOptions {
  workspaceRoot: string;
  artifactDir: string;
  candidatePath: string;
}

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function reject(message: string): never {
  throw new Error(`Artifact cannot be opened: ${message}`);
}

/**
 * Resolve an artifact selected by the renderer without trusting its path.
 *
 * Both lexical and real paths are checked. The latter is important because a
 * file or the configured artifact directory can otherwise escape the current
 * workspace through a symlink.
 */
export async function resolveArtifactFile({
  workspaceRoot,
  artifactDir,
  candidatePath,
}: ResolveArtifactFileOptions): Promise<string> {
  if (!path.isAbsolute(workspaceRoot)) reject('the workspace root is not absolute');
  if (!artifactDir || path.isAbsolute(artifactDir) || artifactDir.includes('\0')) {
    reject('the configured artifact directory is invalid');
  }
  if (!candidatePath || !path.isAbsolute(candidatePath) || candidatePath.includes('\0')) {
    reject('the selected path is not absolute');
  }

  const lexicalWorkspaceRoot = path.resolve(workspaceRoot);
  const lexicalArtifactRoot = path.resolve(lexicalWorkspaceRoot, artifactDir);
  const lexicalCandidate = path.resolve(candidatePath);
  if (!isWithin(lexicalWorkspaceRoot, lexicalArtifactRoot)) {
    reject('the configured artifact directory escapes the current workspace');
  }
  if (!isWithin(lexicalArtifactRoot, lexicalCandidate)) {
    reject('the selected path is outside the current artifact directory');
  }

  let realWorkspaceRoot: string;
  let realArtifactRoot: string;
  let realCandidate: string;
  try {
    [realWorkspaceRoot, realArtifactRoot, realCandidate] = await Promise.all([
      realpath(lexicalWorkspaceRoot),
      realpath(lexicalArtifactRoot),
      realpath(lexicalCandidate),
    ]);
  } catch (error) {
    throw new Error('Artifact cannot be opened: the selected file or artifact directory does not exist', {
      cause: error,
    });
  }

  if (!isWithin(realWorkspaceRoot, realArtifactRoot)) {
    reject('the artifact directory resolves outside the current workspace');
  }
  if (!isWithin(realArtifactRoot, realCandidate)) {
    reject('the selected file resolves outside the current artifact directory');
  }

  const [workspaceInfo, artifactRootInfo, candidateInfo] = await Promise.all([
    stat(realWorkspaceRoot),
    stat(realArtifactRoot),
    stat(realCandidate),
  ]);
  if (!workspaceInfo.isDirectory()) reject('the current workspace is not a directory');
  if (!artifactRootInfo.isDirectory()) reject('the configured artifact path is not a directory');
  if (!candidateInfo.isFile()) reject('the selected path is not a regular file');

  return realCandidate;
}

import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceError } from './errors';

function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function validateRelativePath(candidate: string): void {
  if (candidate.length === 0 || candidate.includes('\0') || path.isAbsolute(candidate)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Path must be workspace-relative: ${JSON.stringify(candidate)}`);
  }
}

/**
 * Resolve a user/config supplied relative path without allowing lexical traversal.
 * Filesystem operations should additionally call assertRealPathWithinWorkspace so
 * an existing symlink cannot escape the root.
 */
export function resolveWorkspacePath(root: string, relativePath: string): string {
  if (!path.isAbsolute(root)) {
    throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', `Workspace root must be absolute: ${root}`);
  }
  validateRelativePath(relativePath);
  const normalizedRoot = path.resolve(root);
  const resolved = path.resolve(normalizedRoot, relativePath);
  if (!isWithin(normalizedRoot, resolved)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Path escapes workspace: ${relativePath}`);
  }
  return resolved;
}

/** Resolve a path that must remain under a configured workspace subdirectory. */
export function resolveWorkspaceChildPath(root: string, directoryPath: string, childPath: string): string {
  validateRelativePath(childPath);
  const directory = resolveWorkspacePath(root, directoryPath);
  const resolved = path.resolve(directory, childPath);
  if (!isWithin(directory, resolved)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Path escapes configured directory: ${childPath}`);
  }
  return resolved;
}

/**
 * Check the target (or its closest existing ancestor) through realpath. This
 * rejects reads and writes through a symlink whose destination is outside root.
 */
export async function assertRealPathWithinWorkspace(root: string, target: string): Promise<void> {
  const absoluteRoot = path.resolve(root);
  let rootStat;
  try {
    rootStat = await lstat(absoluteRoot);
  } catch (error) {
    throw new WorkspaceError('PATH_NOT_FOUND', `Workspace root does not exist: ${absoluteRoot}`, { cause: error });
  }
  if (!rootStat.isDirectory() && !rootStat.isSymbolicLink()) {
    throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', `Workspace root is not a directory: ${absoluteRoot}`);
  }

  const realRoot = await realpath(absoluteRoot);
  if (!(await stat(realRoot)).isDirectory()) {
    throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', `Workspace root is not a directory: ${absoluteRoot}`);
  }
  let cursor = path.resolve(target);
  while (true) {
    try {
      const realCursor = await realpath(cursor);
      if (!isWithin(realRoot, realCursor)) {
        throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Path resolves outside workspace: ${target}`);
      }
      return;
    } catch (error) {
      if (error instanceof WorkspaceError) throw error;
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Could not find a contained ancestor for: ${target}`);
      }
      cursor = parent;
    }
  }
}

/** Lexically resolve and verify existing symlinks in one filesystem-ready operation. */
export async function resolveSafeWorkspacePath(root: string, relativePath: string): Promise<string> {
  const resolved = resolveWorkspacePath(root, relativePath);
  await assertRealPathWithinWorkspace(root, resolved);
  return resolved;
}

/** Resolve a configured subdirectory child and verify its existing ancestors. */
export async function resolveSafeWorkspaceChildPath(
  root: string,
  directoryPath: string,
  childPath: string,
): Promise<string> {
  const resolved = resolveWorkspaceChildPath(root, directoryPath, childPath);
  await assertRealPathWithinWorkspace(root, resolved);
  return resolved;
}

export function toPortableRelativePath(root: string, absolutePath: string): string {
  const relative = path.relative(root, absolutePath);
  if (relative === '' || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Path is not a child of workspace directory: ${absolutePath}`);
  }
  return relative.split(path.sep).join('/');
}

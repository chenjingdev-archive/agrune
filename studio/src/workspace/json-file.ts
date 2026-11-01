import { open, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceError } from './errors';

export const DEFAULT_MAX_JSON_BYTES = 4 * 1024 * 1024;

export async function readJsonFile(filePath: string, maximumBytes = DEFAULT_MAX_JSON_BYTES): Promise<unknown> {
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new WorkspaceError('PATH_NOT_FOUND', `File does not exist: ${filePath}`, { cause: error });
    }
    throw error;
  }
  if (!metadata.isFile()) throw new WorkspaceError('INVALID_JSON', `Expected a regular JSON file: ${filePath}`);
  if (metadata.size > maximumBytes) {
    throw new WorkspaceError('FILE_TOO_LARGE', `JSON file exceeds ${maximumBytes} bytes: ${filePath}`);
  }
  let source: string;
  try {
    source = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new WorkspaceError('INVALID_JSON', `Could not read JSON file: ${filePath}`, { cause: error });
  }
  if (Buffer.byteLength(source, 'utf8') > maximumBytes) {
    throw new WorkspaceError('FILE_TOO_LARGE', `JSON file exceeds ${maximumBytes} bytes: ${filePath}`);
  }
  try {
    return JSON.parse(source) as unknown;
  } catch (error) {
    throw new WorkspaceError('INVALID_JSON', `Invalid JSON in ${filePath}`, { cause: error });
  }
}

/** Write a complete JSON document through a sibling temporary file and rename. */
export async function atomicWriteJson(filePath: string, value: unknown, mode = 0o600): Promise<void> {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value, null, 2);
  } catch (error) {
    throw new WorkspaceError('INVALID_JSON', `Value cannot be serialized as JSON for ${filePath}`, { cause: error });
  }
  if (serialized === undefined) {
    throw new WorkspaceError('INVALID_JSON', `Value cannot be serialized as a JSON document for ${filePath}`);
  }
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporaryPath, 'wx', mode);
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, filePath);

    // Persisting the directory entry is supported on Unix. Some filesystems do
    // not allow opening directories, so durability enhancement is best effort.
    let directoryHandle;
    try {
      directoryHandle = await open(directory, 'r');
      await directoryHandle.sync();
    } catch {
      // The file content is already atomically visible after rename.
    } finally {
      await directoryHandle?.close().catch(() => undefined);
    }
  } catch (error) {
    if (handle !== undefined) await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

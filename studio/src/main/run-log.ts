import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';

const RUN_LOG_FILE_NAME = 'run.json';
const RUN_LOG_MODE = 0o600;

/**
 * Atomically persist one JSON-serializable run evidence document.
 *
 * The caller supplies a workspace-vetted path ending in `run.json`. This
 * helper creates its parent directories, writes and syncs a sibling temporary
 * file, fixes that inode to mode 0600, and then atomically renames it into
 * place. A failed write never leaves the temporary file behind.
 */
export async function writeRunLog(runJsonPath: string, document: unknown): Promise<void> {
  if (path.basename(runJsonPath) !== RUN_LOG_FILE_NAME) {
    throw new TypeError(`Run log path must end in ${RUN_LOG_FILE_NAME}: ${runJsonPath}`);
  }

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(document, null, 2);
  } catch (error) {
    throw new TypeError('Run log document must be JSON serializable.', { cause: error });
  }
  if (serialized === undefined) {
    throw new TypeError('Run log document must serialize to a JSON value.');
  }

  const directory = path.dirname(runJsonPath);
  await mkdir(directory, { recursive: true });
  const temporaryPath = path.join(
    directory,
    `.${RUN_LOG_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;

  try {
    handle = await open(temporaryPath, 'wx', RUN_LOG_MODE);
    await handle.writeFile(`${serialized}\n`, 'utf8');
    await handle.chmod(RUN_LOG_MODE);
    await handle.sync();
    await handle.close();
    handle = undefined;

    // The temporary file is in the destination directory, so this replacement
    // remains a same-filesystem atomic rename and carries its 0600 mode with it.
    await rename(temporaryPath, runJsonPath);
    await syncDirectoryBestEffort(directory);
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function syncDirectoryBestEffort(directory: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(directory, 'r');
    await handle.sync();
  } catch {
    // The file is already atomically visible. Some platforms/filesystems do
    // not support opening or syncing directory handles.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

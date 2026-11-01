import { lstat, mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateScenario, type Scenario } from '../scenario';
import { WorkspaceError } from './errors';
import { atomicWriteJson, readJsonFile } from './json-file';
import {
  assertRealPathWithinWorkspace,
  resolveWorkspaceChildPath,
  resolveWorkspacePath,
  toPortableRelativePath,
} from './paths';
import type { ScenarioFile, ScenarioFileSummary, WorkspaceConfig } from './types';
import { validateWorkspaceConfig } from './validation';

function ensureJsonRelativePath(fileName: string): string {
  if (
    fileName.length === 0 ||
    fileName.includes('\0') ||
    path.isAbsolute(fileName) ||
    path.normalize(fileName) === '..' ||
    path.normalize(fileName).startsWith(`..${path.sep}`)
  ) {
    throw new WorkspaceError('PATH_OUTSIDE_WORKSPACE', `Scenario path must stay in the scenario directory: ${fileName}`);
  }
  if (path.extname(fileName).toLowerCase() !== '.json') {
    throw new WorkspaceError('INVALID_SCENARIO', `Scenario filename must end in .json: ${fileName}`);
  }
  return path.normalize(fileName);
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export class ScenarioStore {
  readonly config: WorkspaceConfig;
  readonly directory: string;

  constructor(config: WorkspaceConfig) {
    const validated = validateWorkspaceConfig(config);
    if (!validated.ok) {
      throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', 'Cannot create scenario store from invalid config', {
        details: validated.errors,
      });
    }
    this.config = validated.value;
    this.directory = resolveWorkspacePath(this.config.root, this.config.scenarioDir);
  }

  private resolve(fileName: string): string {
    const relativeFile = ensureJsonRelativePath(fileName);
    return resolveWorkspaceChildPath(this.config.root, this.config.scenarioDir, relativeFile);
  }

  async list(): Promise<ScenarioFileSummary[]> {
    await assertRealPathWithinWorkspace(this.config.root, this.directory);
    if (!(await pathExists(this.directory))) return [];

    const entries: ScenarioFileSummary[] = [];
    await this.walk(this.directory, entries);
    return entries.sort((left, right) => left.path.localeCompare(right.path));
  }

  private async walk(directory: string, destination: ScenarioFileSummary[]): Promise<void> {
    await assertRealPathWithinWorkspace(this.config.root, directory);
    const directoryEntries = await readdir(directory, { withFileTypes: true });
    for (const entry of directoryEntries) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        await this.walk(absolutePath, destination);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.json') {
        destination.push(await this.summarize(absolutePath));
      }
    }
  }

  private async summarize(filePath: string): Promise<ScenarioFileSummary> {
    const metadata = await stat(filePath);
    const relative = toPortableRelativePath(this.directory, filePath);
    try {
      const input = await readJsonFile(filePath);
      const validation = validateScenario(input);
      if (!validation.ok) {
        return {
          path: relative,
          modifiedAt: metadata.mtime.toISOString(),
          size: metadata.size,
          valid: false,
          errors: validation.errors,
        };
      }
      return {
        path: relative,
        modifiedAt: metadata.mtime.toISOString(),
        size: metadata.size,
        valid: true,
        id: validation.scenario.id,
        name: validation.scenario.name,
        description: validation.scenario.description,
        tags: validation.scenario.tags,
        stepCount: validation.scenario.steps.length,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        path: relative,
        modifiedAt: metadata.mtime.toISOString(),
        size: metadata.size,
        valid: false,
        errors: [{ path: '', message }],
      };
    }
  }

  async read(fileName: string): Promise<ScenarioFile> {
    const filePath = this.resolve(fileName);
    await assertRealPathWithinWorkspace(this.config.root, filePath);
    const input = await readJsonFile(filePath);
    const validation = validateScenario(input);
    if (!validation.ok) {
      throw new WorkspaceError('INVALID_SCENARIO', `Invalid Agrune scenario: ${fileName}`, { details: validation.errors });
    }
    const metadata = await stat(filePath);
    return {
      path: toPortableRelativePath(this.directory, filePath),
      modifiedAt: metadata.mtime.toISOString(),
      size: metadata.size,
      scenario: validation.scenario,
    };
  }

  async write(fileName: string, scenario: Scenario): Promise<ScenarioFile> {
    const validation = validateScenario(scenario);
    if (!validation.ok) {
      throw new WorkspaceError('INVALID_SCENARIO', `Refusing to write invalid Agrune scenario: ${fileName}`, {
        details: validation.errors,
      });
    }
    const filePath = this.resolve(fileName);
    await assertRealPathWithinWorkspace(this.config.root, filePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await assertRealPathWithinWorkspace(this.config.root, path.dirname(filePath));
    await atomicWriteJson(filePath, validation.scenario, 0o644);
    return this.read(fileName);
  }
}

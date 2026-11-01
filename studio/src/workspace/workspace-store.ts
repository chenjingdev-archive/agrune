import path from 'node:path';
import { WorkspaceError } from './errors';
import { atomicWriteJson, readJsonFile } from './json-file';
import {
  assertRealPathWithinWorkspace,
  resolveSafeWorkspaceChildPath,
  resolveSafeWorkspacePath,
  resolveWorkspacePath,
} from './paths';
import { ScenarioStore } from './scenario-store';
import { DEFAULT_WORKSPACE_CONFIG_PATH, type WorkspaceConfig } from './types';
import { validateWorkspaceConfig } from './validation';

function parseConfig(input: unknown): WorkspaceConfig {
  const validation = validateWorkspaceConfig(input);
  if (!validation.ok) {
    throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', 'Invalid Agrune workspace config', {
      details: validation.errors,
    });
  }
  return validation.value;
}

export async function readWorkspaceConfig(
  workspaceRoot: string,
  configPath = DEFAULT_WORKSPACE_CONFIG_PATH,
): Promise<WorkspaceConfig> {
  const normalizedRoot = path.resolve(workspaceRoot);
  const filePath = resolveWorkspacePath(normalizedRoot, configPath);
  await assertRealPathWithinWorkspace(normalizedRoot, filePath);
  const config = parseConfig(await readJsonFile(filePath));
  if (path.resolve(config.root) !== normalizedRoot) {
    throw new WorkspaceError(
      'INVALID_WORKSPACE_CONFIG',
      `Workspace config root does not match its opened workspace: ${config.root}`,
    );
  }
  return config;
}

export async function writeWorkspaceConfig(
  config: WorkspaceConfig,
  configPath = DEFAULT_WORKSPACE_CONFIG_PATH,
): Promise<void> {
  const validated = parseConfig(config);
  const filePath = resolveWorkspacePath(validated.root, configPath);
  await assertRealPathWithinWorkspace(validated.root, filePath);
  await atomicWriteJson(filePath, validated, 0o600);
}

export class WorkspaceStore {
  readonly config: WorkspaceConfig;
  readonly scenarios: ScenarioStore;

  constructor(config: WorkspaceConfig) {
    this.config = parseConfig(config);
    this.scenarios = new ScenarioStore(this.config);
  }

  static async open(workspaceRoot: string, configPath = DEFAULT_WORKSPACE_CONFIG_PATH): Promise<WorkspaceStore> {
    return new WorkspaceStore(await readWorkspaceConfig(workspaceRoot, configPath));
  }

  async saveConfig(configPath = DEFAULT_WORKSPACE_CONFIG_PATH): Promise<void> {
    await writeWorkspaceConfig(this.config, configPath);
  }

  async manifestFile(): Promise<string> {
    return resolveSafeWorkspacePath(this.config.root, this.config.manifestPath);
  }

  async artifactPath(relativePath: string): Promise<string> {
    return resolveSafeWorkspaceChildPath(this.config.root, this.config.artifactDir, relativePath);
  }
}

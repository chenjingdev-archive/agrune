import type { Scenario, ScenarioValidationIssue } from '../scenario';

export const WORKSPACE_SCHEMA_ID = 'agrune.workspace/v1' as const;
export const RECENT_WORKSPACES_SCHEMA_ID = 'agrune.recent-workspaces/v1' as const;

export const DEFAULT_WORKSPACE_CONFIG_PATH = '.agrune/workspace.json';
export const DEFAULT_MANIFEST_PATH = 'manifest.json';
export const DEFAULT_SCENARIO_DIR = '.agrune/scenarios';
export const DEFAULT_ARTIFACT_DIR = '.agrune/artifacts';

export interface WorkspaceConfig {
  schema: typeof WORKSPACE_SCHEMA_ID;
  /** Absolute path. Relative paths in this document are resolved from this directory. */
  root: string;
  baseUrl: string;
  manifestPath: string;
  scenarioDir: string;
  artifactDir: string;
}

export interface WorkspaceConfigInput {
  root: string;
  baseUrl: string;
  manifestPath?: string;
  scenarioDir?: string;
  artifactDir?: string;
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: ValidationIssue[] };

/** @deprecated Import Scenario from ../scenario. Kept as a thin integration alias. */
export type AgruneScenario = Scenario;

export interface ScenarioFileSummary {
  /** POSIX-style path relative to the configured scenario directory. */
  path: string;
  modifiedAt: string;
  size: number;
  valid: boolean;
  id?: string;
  name?: string;
  description?: string;
  tags?: string[];
  stepCount?: number;
  errors?: Array<ScenarioValidationIssue | ValidationIssue>;
}

export interface ScenarioFile {
  path: string;
  modifiedAt: string;
  size: number;
  scenario: Scenario;
}

export interface RecentWorkspace {
  root: string;
  baseUrl: string;
  lastOpenedAt: string;
}

export interface RecentWorkspacesDocument {
  schema: typeof RECENT_WORKSPACES_SCHEMA_ID;
  workspaces: RecentWorkspace[];
}

export interface RecentWorkspacePersistence {
  list(): Promise<RecentWorkspace[]>;
  record(workspace: WorkspaceConfig, openedAt?: Date): Promise<RecentWorkspace[]>;
}

import path from 'node:path';
import {
  DEFAULT_ARTIFACT_DIR,
  DEFAULT_MANIFEST_PATH,
  DEFAULT_SCENARIO_DIR,
  WORKSPACE_SCHEMA_ID,
  type ValidationIssue,
  type ValidationResult,
  type WorkspaceConfig,
  type WorkspaceConfigInput,
} from './types';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function issue(errors: ValidationIssue[], pathName: string, message: string): void {
  errors.push({ path: pathName, message });
}

function unknownFields(record: JsonRecord, allowed: readonly string[], errors: ValidationIssue[]): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) issue(errors, key, 'Unknown field');
  }
}

function requireString(
  record: JsonRecord,
  key: string,
  errors: ValidationIssue[],
  options: { optional?: boolean } = {},
): string | undefined {
  const value = record[key];
  if (value === undefined && options.optional) return undefined;
  if (typeof value !== 'string') {
    issue(errors, key, 'Expected a string');
    return undefined;
  }
  if (value.trim().length === 0) {
    issue(errors, key, 'Must not be empty');
    return undefined;
  }
  return value;
}

function validateRelativeConfigPath(value: unknown, pathName: string, errors: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(errors, pathName, 'Expected a non-empty workspace-relative path');
    return false;
  }
  if (value.includes('\0') || path.isAbsolute(value)) {
    issue(errors, pathName, 'Must be a workspace-relative path');
    return false;
  }
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    issue(errors, pathName, 'Must stay inside the workspace');
    return false;
  }
  return true;
}

function validateBaseUrl(value: unknown, errors: ValidationIssue[]): value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    issue(errors, 'baseUrl', 'Expected a non-empty URL');
    return false;
  }
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(parsed.protocol)) {
      issue(errors, 'baseUrl', 'Expected an http, https, or file URL');
      return false;
    }
  } catch {
    issue(errors, 'baseUrl', 'Expected an absolute URL');
    return false;
  }
  return true;
}

export function createWorkspaceConfig(input: WorkspaceConfigInput): WorkspaceConfig {
  const candidate: WorkspaceConfig = {
    schema: WORKSPACE_SCHEMA_ID,
    root: path.resolve(input.root),
    baseUrl: input.baseUrl,
    manifestPath: input.manifestPath ?? DEFAULT_MANIFEST_PATH,
    scenarioDir: input.scenarioDir ?? DEFAULT_SCENARIO_DIR,
    artifactDir: input.artifactDir ?? DEFAULT_ARTIFACT_DIR,
  };
  const result = validateWorkspaceConfig(candidate);
  if (!result.ok) {
    const detail = result.errors.map((entry) => `${entry.path}: ${entry.message}`).join('; ');
    throw new TypeError(`Invalid workspace config: ${detail}`);
  }
  return result.value;
}

export function validateWorkspaceConfig(input: unknown): ValidationResult<WorkspaceConfig> {
  const errors: ValidationIssue[] = [];
  if (!isRecord(input)) return { ok: false, errors: [{ path: '', message: 'Expected an object' }] };
  unknownFields(input, ['schema', 'root', 'baseUrl', 'manifestPath', 'scenarioDir', 'artifactDir'], errors);

  if (input.schema !== WORKSPACE_SCHEMA_ID) issue(errors, 'schema', `Expected ${WORKSPACE_SCHEMA_ID}`);
  const root = requireString(input, 'root', errors);
  if (root !== undefined && (!path.isAbsolute(root) || root.includes('\0'))) {
    issue(errors, 'root', 'Expected an absolute filesystem path');
  }
  validateBaseUrl(input.baseUrl, errors);
  validateRelativeConfigPath(input.manifestPath, 'manifestPath', errors);
  validateRelativeConfigPath(input.scenarioDir, 'scenarioDir', errors);
  validateRelativeConfigPath(input.artifactDir, 'artifactDir', errors);

  if (errors.length > 0) return { ok: false, errors };
  const config = input as unknown as WorkspaceConfig;
  return {
    ok: true,
    value: {
      ...config,
      root: path.resolve(config.root),
      manifestPath: path.normalize(config.manifestPath),
      scenarioDir: path.normalize(config.scenarioDir),
      artifactDir: path.normalize(config.artifactDir),
    },
  };
}

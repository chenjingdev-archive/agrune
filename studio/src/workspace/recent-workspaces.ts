import path from 'node:path';
import { WorkspaceError } from './errors';
import { atomicWriteJson, readJsonFile } from './json-file';
import {
  RECENT_WORKSPACES_SCHEMA_ID,
  type RecentWorkspace,
  type RecentWorkspacePersistence,
  type RecentWorkspacesDocument,
  type WorkspaceConfig,
} from './types';
import { validateWorkspaceConfig } from './validation';

function validateRecentWorkspace(input: unknown): input is RecentWorkspace {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false;
  const item = input as Record<string, unknown>;
  if (Object.keys(item).some((key) => !['root', 'baseUrl', 'lastOpenedAt'].includes(key))) return false;
  if (typeof item.root !== 'string' || item.root.includes('\0') || !path.isAbsolute(item.root)) return false;
  if (typeof item.baseUrl !== 'string' || typeof item.lastOpenedAt !== 'string') return false;
  return !Number.isNaN(Date.parse(item.lastOpenedAt));
}

function validateDocument(input: unknown): RecentWorkspacesDocument {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    throw new WorkspaceError('INVALID_RECENTS', 'Recent workspaces document must be an object');
  }
  const document = input as Record<string, unknown>;
  if (Object.keys(document).some((key) => !['schema', 'workspaces'].includes(key))) {
    throw new WorkspaceError('INVALID_RECENTS', 'Recent workspaces document contains an unknown field');
  }
  if (document.schema !== RECENT_WORKSPACES_SCHEMA_ID || !Array.isArray(document.workspaces)) {
    throw new WorkspaceError('INVALID_RECENTS', `Expected ${RECENT_WORKSPACES_SCHEMA_ID}`);
  }
  if (!document.workspaces.every(validateRecentWorkspace)) {
    throw new WorkspaceError('INVALID_RECENTS', 'Recent workspaces document contains an invalid entry');
  }
  return document as unknown as RecentWorkspacesDocument;
}

export class JsonRecentWorkspacePersistence implements RecentWorkspacePersistence {
  readonly filePath: string;
  readonly maximumEntries: number;

  constructor(filePath: string, maximumEntries = 12) {
    if (!path.isAbsolute(filePath)) throw new TypeError('Recent workspace file path must be absolute');
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1) throw new TypeError('maximumEntries must be positive');
    this.filePath = filePath;
    this.maximumEntries = maximumEntries;
  }

  async list(): Promise<RecentWorkspace[]> {
    try {
      const document = validateDocument(await readJsonFile(this.filePath));
      return [...document.workspaces].sort(
        (left, right) => Date.parse(right.lastOpenedAt) - Date.parse(left.lastOpenedAt),
      );
    } catch (error) {
      if (error instanceof WorkspaceError && error.code === 'PATH_NOT_FOUND') return [];
      throw error;
    }
  }

  async record(workspace: WorkspaceConfig, openedAt = new Date()): Promise<RecentWorkspace[]> {
    if (Number.isNaN(openedAt.valueOf())) throw new TypeError('openedAt must be a valid date');
    const validated = validateWorkspaceConfig(workspace);
    if (!validated.ok) {
      throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', 'Cannot record an invalid workspace', {
        details: validated.errors,
      });
    }
    const root = path.resolve(validated.value.root);
    const prior = await this.list();
    const next = [
      { root, baseUrl: validated.value.baseUrl, lastOpenedAt: openedAt.toISOString() },
      ...prior.filter((entry) => path.resolve(entry.root) !== root),
    ].slice(0, this.maximumEntries);
    await atomicWriteJson(
      this.filePath,
      { schema: RECENT_WORKSPACES_SCHEMA_ID, workspaces: next } satisfies RecentWorkspacesDocument,
      0o600,
    );
    return next;
  }
}

export class InMemoryRecentWorkspacePersistence implements RecentWorkspacePersistence {
  private workspaces: RecentWorkspace[] = [];

  async list(): Promise<RecentWorkspace[]> {
    return this.workspaces.map((entry) => ({ ...entry }));
  }

  async record(workspace: WorkspaceConfig, openedAt = new Date()): Promise<RecentWorkspace[]> {
    if (Number.isNaN(openedAt.valueOf())) throw new TypeError('openedAt must be a valid date');
    const validated = validateWorkspaceConfig(workspace);
    if (!validated.ok) {
      throw new WorkspaceError('INVALID_WORKSPACE_CONFIG', 'Cannot record an invalid workspace', {
        details: validated.errors,
      });
    }
    const root = path.resolve(validated.value.root);
    this.workspaces = [
      { root, baseUrl: validated.value.baseUrl, lastOpenedAt: openedAt.toISOString() },
      ...this.workspaces.filter((entry) => path.resolve(entry.root) !== root),
    ];
    return this.list();
  }
}

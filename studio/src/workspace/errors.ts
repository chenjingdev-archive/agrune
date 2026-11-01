export type WorkspaceErrorCode =
  | 'INVALID_WORKSPACE_CONFIG'
  | 'PATH_OUTSIDE_WORKSPACE'
  | 'PATH_NOT_FOUND'
  | 'INVALID_JSON'
  | 'INVALID_SCENARIO'
  | 'INVALID_RECENTS'
  | 'FILE_TOO_LARGE';

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly details?: unknown;

  constructor(code: WorkspaceErrorCode, message: string, options: { cause?: unknown; details?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WorkspaceError';
    this.code = code;
    this.details = options.details;
  }
}

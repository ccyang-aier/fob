export type PermissionErrorCode = 'INVALID_PERMISSION_INPUT' | 'PERMISSION_SCOPE_NOT_FOUND' | 'INVALID_PERMISSION_PRINCIPAL' | 'INVALID_PERMISSION_TREE';

/** Internal service errors: HTTP authentication/authorization belongs to P03. */
export class KnowledgePermissionError extends Error {
  constructor(readonly code: PermissionErrorCode) {
    super(`Knowledge permission operation failed: ${code}`);
    this.name = 'KnowledgePermissionError';
  }
}

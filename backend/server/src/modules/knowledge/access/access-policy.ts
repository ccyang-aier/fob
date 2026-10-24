import {
  createKnowledgePatInputSchema,
  entityIdSchema,
  knowledgePatScopes,
  knowledgePatScopesSchema,
  revokeKnowledgePatInputSchema,
} from '@fob/shared/knowledge/contracts';

/** The shared PAT contract governs token issuance and request authorization. */
export const knowledgeTokenScopes = knowledgePatScopes;
export type KnowledgeTokenScope = (typeof knowledgePatScopes)[number];
export const tokenScopesSchema = knowledgePatScopesSchema;
export const tokenKnowledgeBaseSchema = entityIdSchema;
export const createKnowledgeTokenInputSchema = createKnowledgePatInputSchema;
export const revokeKnowledgeTokenInputSchema = revokeKnowledgePatInputSchema;

const failures = {
  UNAUTHENTICATED: { status: 401, message: 'Valid knowledge base credentials are required.' },
  INSUFFICIENT_SCOPE: { status: 403, message: 'This credential does not allow the requested operation.' },
  INVALID_ORIGIN: { status: 403, message: 'A trusted Origin is required.' },
  INVALID_TOKEN_INPUT: { status: 400, message: 'Invalid personal access token request.' },
  AUTH_UNAVAILABLE: { status: 503, message: 'Authentication is temporarily unavailable.' },
} as const;
export type KnowledgeAccessErrorCode = keyof typeof failures;
export type KnowledgeAccessDiagnostic = 'access_denied' | 'access_unavailable';

export class KnowledgeAccessError extends Error {
  readonly status: typeof failures[KnowledgeAccessErrorCode]['status'];
  constructor(readonly code: KnowledgeAccessErrorCode) {
    super(failures[code].message);
    this.name = 'KnowledgeAccessError';
    this.status = failures[code].status;
  }
}

/** Never retain SQL errors, parameters, request headers, or credential text as causes. */
export async function sanitizedAccess<T>(operation: () => Promise<T>, diagnostic?: (event: KnowledgeAccessDiagnostic) => void): Promise<T> {
  try { return await operation(); }
  catch (error) {
    const failure = error instanceof KnowledgeAccessError ? error : new KnowledgeAccessError('AUTH_UNAVAILABLE');
    // An observer failure must not replace the deliberately sanitized auth error.
    try { diagnostic?.(failure.code === 'AUTH_UNAVAILABLE' ? 'access_unavailable' : 'access_denied'); } catch { /* no raw logger errors */ }
    throw failure;
  }
}

export function knowledgeAccessErrorResponse(error: unknown): Response {
  const failure = error instanceof KnowledgeAccessError ? error : new KnowledgeAccessError('AUTH_UNAVAILABLE');
  return Response.json({ code: failure.code, message: failure.message }, {
    status: failure.status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', ...(failure.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="knowledge"' } : {}) },
  });
}

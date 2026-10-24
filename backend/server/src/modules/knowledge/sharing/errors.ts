import { KnowledgeAccessError } from '../access/access-policy';
import { KnowledgePermissionError } from '../permissions/errors';

export type SharingErrorCode =
  | 'INVALID_SHARING_INPUT'
  | 'SHARING_SCOPE_NOT_FOUND'
  | 'SHARING_LINK_NOT_FOUND'
  | 'SHARING_LINK_INACTIVE'
  | 'SHARING_FORBIDDEN'
  | 'SHARING_REBUILDING'
  | 'SHARING_UNAVAILABLE';

const failures: Record<SharingErrorCode, { status: number; message: string; retryable?: boolean }> = {
  INVALID_SHARING_INPUT: { status: 400, message: 'Invalid share link request.' },
  SHARING_SCOPE_NOT_FOUND: { status: 404, message: 'The shared page does not exist.' },
  SHARING_LINK_NOT_FOUND: { status: 404, message: 'The share link does not exist.' },
  SHARING_LINK_INACTIVE: { status: 409, message: 'A revoked share link cannot be changed.' },
  SHARING_FORBIDDEN: { status: 403, message: 'Full access to the page is required to manage its share links.' },
  SHARING_REBUILDING: { status: 503, message: 'Page permissions are being refreshed; retry shortly.', retryable: true },
  SHARING_UNAVAILABLE: { status: 503, message: 'Sharing is temporarily unavailable.', retryable: true },
};

export class KnowledgeSharingError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  constructor(readonly code: SharingErrorCode) {
    super(failures[code].message);
    this.name = 'KnowledgeSharingError';
    this.status = failures[code].status;
    this.retryable = failures[code].retryable ?? false;
  }
}

/** Never retain SQL errors, parameters, request headers, or credential text as causes. */
export async function sanitizedSharing<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof KnowledgeSharingError || error instanceof KnowledgePermissionError || error instanceof KnowledgeAccessError) throw error;
    throw new KnowledgeSharingError('SHARING_UNAVAILABLE');
  }
}

function failureOf(error: unknown): { status: number; body: Record<string, unknown> } {
  if (error instanceof KnowledgeSharingError) {
    return { status: error.status, body: { code: error.code, message: error.message, ...(error.retryable ? { retryable: true } : {}) } };
  }
  if (error instanceof KnowledgeAccessError) {
    return { status: error.status, body: { code: error.code, message: error.message } };
  }
  if (error instanceof KnowledgePermissionError) {
    const status = error.code === 'PERMISSION_SCOPE_NOT_FOUND' ? 404 : error.code === 'INVALID_PERMISSION_TREE' ? 503 : 400;
    return { status, body: { code: error.code, message: 'The shared page permissions are not usable right now.' } };
  }
  const unavailable = new KnowledgeSharingError('SHARING_UNAVAILABLE');
  return { status: unavailable.status, body: { code: unavailable.code, message: unavailable.message, retryable: true } };
}

export function sharingErrorResponse(error: unknown): Response {
  const { status, body } = failureOf(error);
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
}

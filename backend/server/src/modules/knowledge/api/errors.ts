import { TRPCError } from '@trpc/server';
import type { TRPC_ERROR_CODE_KEY } from '@trpc/server';
import { getHTTPStatusCodeFromError } from '@trpc/server/http';
import { TRPC_ERROR_CODES_BY_KEY } from '@trpc/server/rpc';
import { KnowledgeAccessError } from '../access';

const messages: Record<TRPC_ERROR_CODE_KEY, string> = {
  PARSE_ERROR: 'Invalid JSON request.',
  BAD_REQUEST: 'Invalid request input.',
  INTERNAL_SERVER_ERROR: 'The request could not be completed.',
  NOT_IMPLEMENTED: 'This operation is not available.',
  BAD_GATEWAY: 'A required service is unavailable.',
  SERVICE_UNAVAILABLE: 'The service is temporarily unavailable.',
  GATEWAY_TIMEOUT: 'A required service did not respond in time.',
  UNAUTHORIZED: 'Valid knowledge base credentials are required.',
  PAYMENT_REQUIRED: 'This operation requires additional access.',
  FORBIDDEN: 'This request is not permitted.',
  NOT_FOUND: 'The requested operation was not found.',
  METHOD_NOT_SUPPORTED: 'This HTTP method is not supported.',
  TIMEOUT: 'The request timed out.',
  CONFLICT: 'The request conflicts with the current state.',
  PRECONDITION_FAILED: 'A request precondition was not met.',
  PAYLOAD_TOO_LARGE: 'The request exceeds the size limit.',
  UNSUPPORTED_MEDIA_TYPE: 'Only JSON requests are supported.',
  UNPROCESSABLE_CONTENT: 'The request content cannot be processed.',
  PRECONDITION_REQUIRED: 'A request precondition is required.',
  TOO_MANY_REQUESTS: 'Too many requests.',
  CLIENT_CLOSED_REQUEST: 'The request was cancelled.',
};

/** Errors are an allowlisted protocol, never a serialization of an exception. */
export function apiError(error: unknown): TRPCError {
  let code: TRPC_ERROR_CODE_KEY = 'INTERNAL_SERVER_ERROR';
  if (error instanceof KnowledgeAccessError) {
    code = error.code === 'UNAUTHENTICATED' ? 'UNAUTHORIZED'
      : error.code === 'AUTH_UNAVAILABLE' ? 'SERVICE_UNAVAILABLE'
        : error.code === 'INVALID_TOKEN_INPUT' ? 'BAD_REQUEST' : 'FORBIDDEN';
  } else if (error instanceof TRPCError && Object.hasOwn(messages, error.code)) code = error.code;
  return new TRPCError({ code, message: messages[code] });
}

export function apiErrorShape(error: unknown, requestId: string | null) {
  const safe = apiError(error);
  return {
    message: safe.message,
    code: TRPC_ERROR_CODES_BY_KEY[safe.code],
    data: { code: safe.code, httpStatus: getHTTPStatusCodeFromError(safe), requestId },
  };
}

export interface KnowledgeApiDiagnostic {
  readonly requestId: string;
  readonly code: TRPC_ERROR_CODE_KEY;
  readonly status: number;
}

export function reportApiError(error: unknown, requestId: string, observer?: (event: KnowledgeApiDiagnostic) => void) {
  const shape = apiErrorShape(error, requestId);
  try { observer?.({ requestId, code: shape.data.code, status: shape.data.httpStatus }); } catch { /* observers cannot replace the safe response */ }
}

export function apiErrorResponse(error: unknown, requestId: string): Response {
  const shape = apiErrorShape(error, requestId);
  return Response.json({ error: shape }, { status: shape.data.httpStatus });
}

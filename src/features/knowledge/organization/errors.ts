import { createTranslator, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './errors.messages';
/**
 * Shared knowledgeBase organization client error boundary.
 *
 * The organization REST surface (backend/server/src/modules/knowledge/organization/http.ts)
 * answers with `{ code, message }` bodies from a fixed code set plus transport
 * failures. Everything is normalized here into one domain error so UI consumers
 * branch on a stable `code`; Chinese copy for each code lives in this module so
 * every surface renders the same structured message.
 */

export type OrganizationErrorCode =
  // Server-emitted organization codes.
  | 'INVALID_INPUT'
  | 'UNAUTHENTICATED'
  | 'KNOWLEDGE_BASE_NOT_FOUND'
  | 'FORBIDDEN'
  | 'MEMBER_NOT_FOUND'
  | 'GROUP_NOT_FOUND'
  | 'TEAMSPACE_NOT_FOUND'
  | 'TEAMSPACE_NOT_EMPTY'
  | 'LAST_OWNER'
  | 'CONFLICT'
  | 'INVITATION_INVALID'
  // Request-envelope codes emitted by the route middleware.
  | 'INVALID_ORIGIN'
  | 'INVALID_CONTENT_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'ORGANIZATION_UNAVAILABLE'
  // Transport codes produced only by this client.
  | 'NETWORK'
  | 'ENDPOINT'
  | 'TIMEOUT';

export function organizationErrorText(locale?: Locale): Record<OrganizationErrorCode, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    INVALID_INPUT: knowledgeT('invalidRequestCheckTheParametersAndRetry'),
    UNAUTHENTICATED: knowledgeT('signInWithAVerifiedSessionToAccess'),
    KNOWLEDGE_BASE_NOT_FOUND: knowledgeT('knowledgeBaseNotFoundOrInaccessible'),
    FORBIDDEN: knowledgeT('yourRoleCannotPerformThisAction'),
    MEMBER_NOT_FOUND: knowledgeT('memberNotFoundOrHasLeftTheKnowledge'),
    GROUP_NOT_FOUND: knowledgeT('groupNotFoundOrHasBeenDeleted'),
    TEAMSPACE_NOT_FOUND: knowledgeT('folderNotFoundOrHasBeenDeleted'),
    TEAMSPACE_NOT_EMPTY: knowledgeT('removeAllPagesBeforeDeletingThisFolder'),
    LAST_OWNER: knowledgeT('aKnowledgeBaseMustHaveAtLeastOne'),
    CONFLICT: knowledgeT('thisActionConflictsWithTheCurrentStateRefresh'),
    INVITATION_INVALID: knowledgeT('invitationIsNoLongerValid'),
    INVALID_ORIGIN: knowledgeT('requestOriginIsNotTrusted'),
    INVALID_CONTENT_TYPE: knowledgeT('invalidRequestFormat'),
    PAYLOAD_TOO_LARGE: knowledgeT('requestExceedsTheSizeLimit'),
    ORGANIZATION_UNAVAILABLE: knowledgeT('organizationServiceUnavailableRetryLater'),
    NETWORK: knowledgeT('unableToConnectToOrganizationServiceCheckYour'),
    ENDPOINT: knowledgeT('unableToResolveOrganizationServiceAddress'),
    TIMEOUT: knowledgeT('requestTimedOutPleaseRetry'),
  };
}

const serverCodes = new Set<string>([
  'INVALID_INPUT',
  'UNAUTHENTICATED',
  'KNOWLEDGE_BASE_NOT_FOUND',
  'FORBIDDEN',
  'MEMBER_NOT_FOUND',
  'GROUP_NOT_FOUND',
  'TEAMSPACE_NOT_FOUND',
  'TEAMSPACE_NOT_EMPTY',
  'LAST_OWNER',
  'CONFLICT',
  'INVITATION_INVALID',
  'INVALID_ORIGIN',
  'INVALID_CONTENT_TYPE',
  'PAYLOAD_TOO_LARGE',
  'ORGANIZATION_UNAVAILABLE',
]);

export class OrganizationDataError extends Error {
  readonly code: OrganizationErrorCode;
  readonly httpStatus: number | null;

  constructor(
    code: OrganizationErrorCode,
    options: { message?: string; httpStatus?: number | null; cause?: unknown } = {},
  ) {
    super(options.message ?? organizationErrorText()[code], { cause: options.cause });
    this.name = 'OrganizationDataError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
  }
}

export function isOrganizationDataError(error: unknown): error is OrganizationDataError {
  return error instanceof OrganizationDataError;
}

export function organizationErrorTextOf(error: unknown): string {
  return isOrganizationDataError(error)
    ? organizationErrorText()[error.code]
    : organizationErrorText().NETWORK;
}

/** Only transient conditions retry; auth, permission and request errors must surface immediately. */
export function isRetryableOrganizationError(error: unknown): boolean {
  return (
    isOrganizationDataError(error) &&
    (error.code === 'NETWORK' ||
      error.code === 'ORGANIZATION_UNAVAILABLE' ||
      error.code === 'TIMEOUT')
  );
}

/** Any error body shape the middleware can emit: `{ code: string, ... }`. */
export function organizationErrorFromBody(status: number, body: unknown): OrganizationDataError {
  const code = (body as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && serverCodes.has(code)) {
    return new OrganizationDataError(code as OrganizationErrorCode, {
      httpStatus: status,
      message: undefined,
    });
  }
  return new OrganizationDataError('ORGANIZATION_UNAVAILABLE', { httpStatus: status });
}

/**
 * Normalize any failure below this data layer. Endpoint resolution failures from
 * the U01 layer carry their own `code` and map across directly; an aborted
 * signal keeps the original cause so the query layer recognizes cancellation.
 */
export function normalizeOrganizationError(cause: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return cause;
  if (isOrganizationDataError(cause)) return cause;
  const code = (cause as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && serverCodes.has(code)) {
    return new OrganizationDataError(code as OrganizationErrorCode, { cause });
  }
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError')
      return new OrganizationDataError('TIMEOUT', { cause });
    if (typeof code === 'string' && code === 'ENDPOINT')
      return new OrganizationDataError('ENDPOINT', { cause });
    return new OrganizationDataError('NETWORK', { cause });
  }
  return new OrganizationDataError('NETWORK', { cause });
}

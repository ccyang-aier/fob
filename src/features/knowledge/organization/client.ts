import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './client.messages';

/**
 * Organization REST client (O02).
 *
 * The organization service is a plain Hono REST surface under
 * `/api/knowledge-bases` — not the knowledge-base-scoped tRPC transport of U01 —
 * so this module owns its own endpoint mapping while reusing the U01 endpoint
 * resolver (`getFobApiOrigin`) and following the same error-normalization
 * pattern. Contract: mutations send `application/json` bodies; DELETE requests
 * carry an empty `{}` body because the route middleware demands JSON on every
 * non-GET request; list endpoints paginate by UUID cursor.
 */

import { authenticatedFetch } from '@/lib/authenticated-fetch';
import type { MemberRole } from '@fob/shared/resources';
import type { KnowledgeBaseMemberSummary } from '@fob/shared/knowledge/contracts';
import { changeMemberRolesInputSchema } from '@fob/shared/knowledge/contracts';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import {
  OrganizationDataError,
  normalizeOrganizationError,
  organizationErrorFromBody,
} from './errors';

const knowledgeT = createTranslator(knowledgeMessages);

export type { MemberRole, KnowledgeBaseMemberSummary };

export type MemberRecord = Pick<KnowledgeBaseMemberSummary, 'knowledgeBaseId' | 'userId' | 'role'>;
export type OrganizationPage<T> = { items: T[]; nextCursor: string | null };
export type RemovedResult = { removed: true };

export const memberRoles: readonly MemberRole[] = ['owner', 'admin', 'member', 'viewer', 'guest'];

const organizationPathPrefix = '/api/knowledge-bases';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Mirrors the shared `name` contract (`trim + 1..120 chars`) before any request is sent. */
export function validateOrganizationName(
  raw: string,
): { ok: true; value: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (value.length === 0) return { ok: false, reason: knowledgeT('nameIsRequired') };
  if (value.length > 120)
    return { ok: false, reason: knowledgeT('nameMustNotExceed120Characters') };
  return { ok: true, value };
}

export function requireUuid(value: string, field: string): string {
  if (!uuidPattern.test(value))
    throw new OrganizationDataError('INVALID_INPUT', {
      message: knowledgeT('valueMustBeAUuid', { v0: field }),
    });
  return value;
}

export function requireName(value: string): string {
  const parsed = validateOrganizationName(value);
  if (!parsed.ok) throw new OrganizationDataError('INVALID_INPUT', { message: parsed.reason });
  return parsed.value;
}

function requireRole(value: MemberRole): MemberRole {
  if (!memberRoles.includes(value))
    throw new OrganizationDataError('INVALID_INPUT', { message: knowledgeT('unknownMemberRole') });
  return value;
}

export type OrganizationListOptions = {
  cursor?: string | null;
  limit?: number;
  signal?: AbortSignal;
};

export type OrganizationClientDeps = {
  /** Resolved API origin (the U01 resolver in the browser binding). */
  origin: () => Promise<string>;
  fetchImpl: typeof fetch;
};

export type RequestOptions = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  signal?: AbortSignal;
};

function buildUrl(origin: string, request: RequestOptions): string {
  const url = new URL(`${origin}${request.path}`);
  for (const [key, value] of Object.entries(request.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function createOrganizationRequest(deps: OrganizationClientDeps) {
  return async function request<T>(request: RequestOptions): Promise<T> {
    let origin: string;
    try {
      origin = await deps.origin();
    } catch (cause) {
      throw normalizeOrganizationError(cause, request.signal);
    }
    // DELETE carries `{}`: the route middleware requires a JSON body on every non-GET request.
    const hasBody = request.method !== 'GET';
    let response: Response;
    try {
      response = await deps.fetchImpl(buildUrl(origin, request), {
        method: request.method,
        headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
        body: hasBody ? JSON.stringify(request.body ?? {}) : undefined,
        credentials: 'include',
        signal: request.signal,
      });
    } catch (cause) {
      throw normalizeOrganizationError(cause, request.signal);
    }
    if (response.ok) {
      try {
        return (await response.json()) as T;
      } catch (cause) {
        throw normalizeOrganizationError(
          new OrganizationDataError('ORGANIZATION_UNAVAILABLE', {
            httpStatus: response.status,
            cause,
          }),
          request.signal,
        );
      }
    }
    const body = await response.json().catch(() => null);
    throw normalizeOrganizationError(
      organizationErrorFromBody(response.status, body),
      request.signal,
    );
  };
}

export function listQuery(
  options: OrganizationListOptions,
): Record<string, string | number | undefined> {
  if (
    options.cursor !== undefined &&
    options.cursor !== null &&
    !uuidPattern.test(options.cursor)
  ) {
    throw new OrganizationDataError('INVALID_INPUT', { message: knowledgeT('cursorMustBeAUuid') });
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100)
  ) {
    throw new OrganizationDataError('INVALID_INPUT', {
      message: knowledgeT('limitMustBeAnIntegerBetween1And'),
    });
  }
  return { cursor: options.cursor ?? undefined, limit: options.limit };
}

export function createOrganizationClient(deps: OrganizationClientDeps) {
  const request = createOrganizationRequest(deps);
  return {
    listMembers(knowledgeBaseId: string, options: OrganizationListOptions = {}) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      return request<OrganizationPage<KnowledgeBaseMemberSummary>>({
        method: 'GET',
        path: `${organizationPathPrefix}/${scope}/members`,
        query: listQuery(options),
        signal: options.signal,
      });
    },
    changeMemberRole(knowledgeBaseId: string, input: { userId: string; role: MemberRole }) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      const userId = requireUuid(input.userId, 'userId');
      return request<MemberRecord>({
        method: 'PATCH',
        path: `${organizationPathPrefix}/${scope}/members/${userId}`,
        body: { role: requireRole(input.role) },
      });
    },
    changeMemberRoles(knowledgeBaseId: string, input: { userIds: string[]; role: MemberRole }) {
      const parsed = changeMemberRolesInputSchema.parse({ ...input, knowledgeBaseId });
      return request<MemberRecord[]>({ method: 'PATCH', path: `${organizationPathPrefix}/${parsed.knowledgeBaseId}/members`, body: { userIds: parsed.userIds, role: parsed.role } });
    },
    removeMember(knowledgeBaseId: string, userId: string) {
      const scope = requireUuid(knowledgeBaseId, 'knowledgeBaseId');
      const target = requireUuid(userId, 'userId');
      return request<RemovedResult>({
        method: 'DELETE',
        path: `${organizationPathPrefix}/${scope}/members/${target}`,
        body: {},
      });
    },

  };
}

export type OrganizationClient = ReturnType<typeof createOrganizationClient>;

/** Browser binding: the same origin resolver as the tRPC transport; cookies are the credential. */
export const organizationClient: OrganizationClient = createOrganizationClient({
  origin: async () => (await getFobApiOrigin()).origin,
  fetchImpl: authenticatedFetch,
});

'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './notifications-api.messages';

/**
 * Notification inbox client surface (N03) over plain knowledge-base-scoped HTTP.
 *
 * The backend routes (backend/server/src/modules/knowledge/notifications/http.ts) live outside
 * the tRPC boundary, so this client owns a small fetch transport with the same
 * semantics as the tRPC layer: cookies always ride along
 * (`credentials: 'include'`), inputs are validated client-side against the
 * shared contracts before the call, every response is re-validated at this
 * boundary, and failures normalize to `KnowledgeDataError` — never fabricated
 * inbox data.
 */

import { authenticatedFetch } from '@/lib/authenticated-fetch';
import {
  markAllNotificationsReadResultSchema,
  markNotificationReadResultSchema,
  notificationListInputSchema,
  notificationListResultSchema,
  notificationUnreadCountResultSchema,
} from '@fob/shared/knowledge/notifications';
import type {
  NotificationItem,
  NotificationListResult,
} from '@fob/shared/knowledge/notifications';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { KnowledgeDataError } from '../data/errors';

const knowledgeT = createTranslator(knowledgeMessages);

export type KnowledgeNotificationsFetch = typeof fetch;

const statusCodes: Record<
  number,
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'UNAVAILABLE'
> = {
  400: 'INVALID_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  413: 'PAYLOAD_TOO_LARGE',
  429: 'RATE_LIMITED',
};

/** Path builder on the shared prefix contract; callers prepend the resolved origin. */
export function knowledgeNotificationsPath(
  knowledgeBaseId: string,
  route: 'inbox' | 'unread-count' | 'read-all' = 'inbox',
  notificationId?: string,
): string {
  const base = `/api/knowledge/${knowledgeBaseId}/notifications`;
  if (route === 'read-all') return `${base}/read-all`;
  if (route === 'unread-count') return `${base}/unread-count`;
  return notificationId ? `${base}/${notificationId}/read` : base;
}

/** A response the shared contracts reject is an unavailable service, never data to render. */
function parseNotificationPayload<T>(
  schema: { safeParse(payload: unknown): { success: true; data: T } | { success: false } },
  payload: unknown,
  procedure: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new KnowledgeDataError('UNAVAILABLE', {
      message: knowledgeT('invalidResponseFromNotificationServiceValue', { v0: procedure }),
    });
  }
  return parsed.data;
}

export interface KnowledgeNotificationsCursor {
  before: string;
  beforeId: string;
}

export type KnowledgeNotificationsApi = {
  listInbox(
    knowledgeBaseId: string,
    options: { limit?: number; cursor?: KnowledgeNotificationsCursor },
    signal?: AbortSignal,
  ): Promise<NotificationListResult>;
  unreadCount(knowledgeBaseId: string, signal?: AbortSignal): Promise<number>;
  markRead(
    knowledgeBaseId: string,
    notificationId: string,
    signal?: AbortSignal,
  ): Promise<NotificationItem>;
  markAllRead(knowledgeBaseId: string, signal?: AbortSignal): Promise<number>;
};

export function createKnowledgeNotificationsApi(deps: {
  resolveOrigin: () => Promise<string> | string;
  fetchImpl?: KnowledgeNotificationsFetch;
}): KnowledgeNotificationsApi {
  const fetchImpl = deps.fetchImpl ?? authenticatedFetch;

  async function call<T>(
    path: string,
    init: RequestInit,
    signal: AbortSignal | undefined,
    procedure: string,
    parse: (payload: unknown) => T,
  ): Promise<T> {
    let response: Response;
    try {
      const origin = await deps.resolveOrigin();
      response = await fetchImpl(new URL(path, origin).toString(), {
        ...init,
        signal,
        credentials: 'include',
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      throw new KnowledgeDataError('NETWORK', { cause });
    }
    if (!response.ok) {
      throw new KnowledgeDataError(statusCodes[response.status] ?? 'UNAVAILABLE', {
        httpStatus: response.status,
      });
    }
    return parse(await response.json().catch(() => null));
  }

  return {
    async listInbox(knowledgeBaseId, options, signal) {
      const input = notificationListInputSchema.safeParse({
        knowledgeBaseId,
        limit: options.limit ?? 30,
        ...(options.cursor
          ? { before: options.cursor.before, beforeId: options.cursor.beforeId }
          : {}),
      });
      if (!input.success)
        throw new KnowledgeDataError('INVALID_REQUEST', {
          message: knowledgeT('invalidNotificationsListinboxInput'),
        });
      const query = new URLSearchParams({ limit: String(input.data.limit) });
      if (input.data.before !== undefined) {
        query.set('before', input.data.before);
        query.set('beforeId', input.data.beforeId!);
      }
      return call(
        `${knowledgeNotificationsPath(knowledgeBaseId)}?${query.toString()}`,
        { method: 'GET' },
        signal,
        'list',
        (payload) => parseNotificationPayload(notificationListResultSchema, payload, 'list'),
      );
    },
    unreadCount(knowledgeBaseId, signal) {
      return call(
        knowledgeNotificationsPath(knowledgeBaseId, 'unread-count'),
        { method: 'GET' },
        signal,
        'unread-count',
        (payload) =>
          parseNotificationPayload(notificationUnreadCountResultSchema, payload, 'unread-count')
            .unreadCount,
      );
    },
    markRead(knowledgeBaseId, notificationId, signal) {
      return call(
        knowledgeNotificationsPath(knowledgeBaseId, 'inbox', notificationId),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        signal,
        'read',
        (payload) =>
          parseNotificationPayload(markNotificationReadResultSchema, payload, 'read').notification,
      );
    },
    markAllRead(knowledgeBaseId, signal) {
      return call(
        knowledgeNotificationsPath(knowledgeBaseId, 'read-all'),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' },
        signal,
        'read-all',
        (payload) =>
          parseNotificationPayload(markAllNotificationsReadResultSchema, payload, 'read-all')
            .updated,
      );
    },
  };
}

/** The browser binding the React hooks call. */
export const knowledgeNotificationsApi = createKnowledgeNotificationsApi({
  resolveOrigin: () => getFobApiOrigin().then(({ origin }) => origin),
});

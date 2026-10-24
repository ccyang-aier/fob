import { describe, expect, test } from 'bun:test';
import type { NotificationListResult } from '@fob/shared/knowledge/notifications';
import { isKnowledgeDataError } from '../data/errors';
import { createKnowledgeNotificationsApi, knowledgeNotificationsPath } from './notifications-api';

/**
 * The notification transport surface (N03) over a captured fetch: every call
 * lands on the knowledge-base-scoped route with credentials, contract inputs are
 * validated client-side, responses are re-validated through the shared
 * contracts, and a payload the contracts reject is UNAVAILABLE — never inbox
 * data to render.
 */

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const notificationId = '30000000-0000-4000-8000-000000000001';
const threadId = '10000000-0000-4000-8000-00000000000a';
const commentId = '10000000-0000-4000-8000-00000000000b';
const actorId = '50000000-0000-4000-8000-000000000000';

type CapturedRequest = { url: string; method: string; credentials?: RequestInit['credentials']; body?: string };

function capturingFetch(respond: () => { status: number; body: string }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: (init?.method ?? 'GET').toUpperCase(),
      credentials: init?.credentials,
      body: typeof init?.body === 'string' ? init.body : undefined,
    });
    const { status, body } = respond();
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const item = (overrides: Partial<NotificationListResult['items'][number]> = {}): NotificationListResult['items'][number] => ({
  knowledgeBaseId: knowledgeBase,
  id: notificationId,
  kind: 'comment.mention',
  pageId: '10000000-0000-4000-8000-000000000001',
  page: { id: '10000000-0000-4000-8000-000000000001', title: '首页' },
  actor: { id: actorId, name: '作者' },
  payload: { threadId, commentId, actorId },
  readAt: null,
  createdAt: '2026-09-26T08:00:00+00:00',
  ...overrides,
});

const apiWith = (fetchImpl: typeof fetch) => createKnowledgeNotificationsApi({ resolveOrigin: () => origin, fetchImpl });

describe('notifications api · listInbox', () => {
  test('GETs the inbox route with credentials and the contract query', async () => {
    const one = item();
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify({ items: [one], unreadCount: 1, nextCursor: null }) }));
    const result = await apiWith(fetchImpl).listInbox(knowledgeBase, { limit: 15, cursor: { before: '2026-09-26T07:00:00+00:00', beforeId: notificationId } });
    expect(result.items[0]).toEqual(one);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.credentials).toBe('include');
    const [path, query] = requests[0]!.url.split('?');
    expect(path).toBe(`https://api.fob.example${knowledgeNotificationsPath(knowledgeBase)}`);
    expect(new URLSearchParams(query!).get('limit')).toBe('15');
    expect(new URLSearchParams(query!).get('before')).toBe('2026-09-26T07:00:00+00:00');
    expect(new URLSearchParams(query!).get('beforeId')).toBe(notificationId);
  });

  test('a payload the contract rejects is UNAVAILABLE, never rendered data', async () => {
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify({ items: [{ id: 'not-a-uuid' }], unreadCount: 0, nextCursor: null }) }));
    const error = await apiWith(fetchImpl).listInbox(knowledgeBase, {}).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
  });

  test('an invalid cursor is refused client-side without a request', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: '{}' }));
    const error = await apiWith(fetchImpl).listInbox(knowledgeBase, { cursor: { before: 'yesterday', beforeId: notificationId } }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('INVALID_REQUEST');
    expect(requests).toHaveLength(0);
  });
});

describe('notifications api · unreadCount / markRead / markAllRead', () => {
  test('reads the badge count from the unread-count route', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify({ unreadCount: 4 }) }));
    expect(await apiWith(fetchImpl).unreadCount(knowledgeBase)).toBe(4);
    expect(requests[0]!.url).toBe(`https://api.fob.example${knowledgeNotificationsPath(knowledgeBase, 'unread-count')}`);
  });

  test('marks one notification read with a JSON POST to its read route', async () => {
    const read = item({ readAt: '2026-09-26T09:00:00+00:00' });
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify({ notification: read }) }));
    expect(await apiWith(fetchImpl).markRead(knowledgeBase, notificationId)).toEqual(read);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url).toBe(`https://api.fob.example${knowledgeNotificationsPath(knowledgeBase, 'inbox', notificationId)}`);
    expect(requests[0]!.credentials).toBe('include');
  });

  test('marks everything read and reports the server count', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify({ updated: 7 }) }));
    expect(await apiWith(fetchImpl).markAllRead(knowledgeBase)).toBe(7);
    expect(requests[0]!.url.endsWith(knowledgeNotificationsPath(knowledgeBase, 'read-all'))).toBe(true);
  });

  test('HTTP error statuses map to domain codes', async () => {
    const cases: Array<[number, string]> = [[401, 'UNAUTHENTICATED'], [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [500, 'UNAVAILABLE']];
    for (const [status, code] of cases) {
      const { fetchImpl } = capturingFetch(() => ({ status, body: JSON.stringify({ code: 'X', message: 'no' }) }));
      const error = await apiWith(fetchImpl).markAllRead(knowledgeBase).catch((cause: unknown) => cause);
      expect(isKnowledgeDataError(error)).toBe(true);
      expect((error as { code: string }).code).toBe(code);
    }
  });
});

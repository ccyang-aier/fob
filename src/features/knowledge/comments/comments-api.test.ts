import { describe, expect, test } from 'bun:test';
import type { CommentThread } from '@fob/shared/knowledge/comments';
import { isKnowledgeDataError } from '../data/errors';
import { knowledgeTrpcUrl } from '../data/endpoint';
import { createKnowledgeCommentsApi } from './comments-api';

/**
 * The comment transport surface (N02) over the real @trpc/client link chain:
 * every procedure call lands on the knowledgeBase transport URL with the contract
 * input, every response is validated through the shared contracts, and the
 * honest pre-route state (comment.* not mounted yet) is NOT_FOUND — never
 * fabricated threads.
 */

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const page = '10000000-0000-4000-8000-000000000001';
const threadId = '10000000-0000-4000-8000-00000000000a';
const commentId = '10000000-0000-4000-8000-00000000000b';

type CapturedRequest = { url: string; method: string; body?: string };

function capturingFetch(respond: () => { status: number; body: string }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : undefined });
    const { status, body } = respond();
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

function fullThread(overrides: Partial<CommentThread> = {}): CommentThread {
  return {
    knowledgeBaseId: knowledgeBase,
    id: threadId,
    pageId: page,
    kind: 'issue', anchorKind: 'selection', status: 'open',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    comments: [{
      knowledgeBaseId: knowledgeBase,
      id: commentId,
      threadId,
      authorId: '50000000-0000-4000-8000-000000000000',
      replyToCommentId: null,
      likeCount: 0, liked: false,
      bodyMd: '第一条',
      createdAt: '2026-09-26T00:00:00Z',
      updatedAt: '2026-09-26T00:00:00Z',
    }],
    ...overrides,
  };
}

const createdResult = () => ({
  thread: fullThread(),
  comment: fullThread().comments[0],
  notified: [] as string[],
  existing: false,
});

const apiWith = (fetchImpl: typeof fetch) => createKnowledgeCommentsApi({ resolveOrigin: () => origin, fetchImpl });

describe('comments api · listThreads', () => {
  test('queries comment.list on the knowledgeBase transport URL and validates threads through the contract', async () => {
    const thread = fullThread();
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: [thread] } }]) }));
    const threads = await apiWith(fetchImpl).listThreads(knowledgeBase, page);
    expect(threads).toEqual([thread]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/comment.list?`)).toBe(true);
    expect(decodeURIComponent(requests[0]!.url)).toContain(`"pageId":"${page}"`);
  });

  test('a payload the contract rejects is an UNAVAILABLE error, never rendered data', async () => {
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: [{ id: 'not-a-uuid', status: 'suspicious' }] } }]) }));
    const error = await apiWith(fetchImpl).listThreads(knowledgeBase, page).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
    expect((error as { message: string }).message).toContain('不符合契约');
  });

  test('the honest pre-route state normalizes to NOT_FOUND', async () => {
    const { fetchImpl } = capturingFetch(() => ({
      status: 404,
      // The tRPC wire envelope: numeric transport code + the tRPC code in data.
      body: JSON.stringify([
        { error: { code: -32003, message: 'No procedure found on path "comment.list"', data: { code: 'NOT_FOUND', httpStatus: 404, requestId: 'req-1' } } },
      ]),
    }));
    const error = await apiWith(fetchImpl).listThreads(knowledgeBase, page).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('NOT_FOUND');
    expect((error as { requestId: string | null }).requestId).toBe('req-1');
  });
});

describe('comments api · mutations', () => {
  test('editing sends the knowledge-base-scoped body and validates the saved entry', async () => {
    const saved = { ...fullThread().comments[0], bodyMd: '已编辑' };
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: { comment: saved } } }]) }));
    expect((await apiWith(fetchImpl).updateComment(knowledgeBase, commentId, '已编辑')).comment).toEqual(saved);
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/comment.update?`)).toBe(true);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, commentId, bodyMd: '已编辑' } });
    const before = requests.length;
    await expect(apiWith(fetchImpl).updateComment(knowledgeBase, commentId, ' ')).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(requests).toHaveLength(before);
  });
  test('create posts the client thread and comment ids the CRDT anchor already carries', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: createdResult() } }]) }));
    const result = await apiWith(fetchImpl).createThread(knowledgeBase, { pageId: page, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: '锚点评论' });
    expect(result.existing).toBe(false);
    expect(result.thread.id).toBe(threadId);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/comment.create?`)).toBe(true);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, pageId: page, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: '锚点评论', mentions: [] } });
  });

  test('reply, resolve, reopen and delete send their contract shapes', async () => {
    const queue = [
      { status: 200, body: JSON.stringify([{ result: { data: { thread: fullThread(), comment: fullThread().comments[0], notified: [] } } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: { thread: fullThread({ status: 'resolved' }), changed: true } } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: { thread: fullThread(), changed: true } } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: { threadDeleted: true } } }]) },
    ];
    const { requests, fetchImpl } = capturingFetch(() => queue.shift()!);
    const api = apiWith(fetchImpl);
    await api.replyThread(knowledgeBase, { threadId, bodyMd: '回复' });
    await api.resolveThread(knowledgeBase, threadId);
    await api.reopenThread(knowledgeBase, threadId);
    await api.deleteComment(knowledgeBase, commentId);
    expect(requests.map((request) => request.url.split('/').pop()?.split('?')[0])).toEqual(['comment.reply', 'comment.resolve', 'comment.reopen', 'comment.delete']);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, threadId, bodyMd: '回复', mentions: [] } });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, threadId } });
    expect(JSON.parse(requests[3]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, commentId } });
  });

  test('a create result missing the idempotency flag is rejected by the strict contract', async () => {
    const partial = createdResult() as { existing?: boolean };
    delete partial.existing;
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: partial } }]) }));
    const error = await apiWith(fetchImpl).createThread(knowledgeBase, { pageId: page, threadId, commentId, kind: 'issue', anchorKind: 'selection', bodyMd: 'x' }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
  });

  test('invalid client input fails fast as INVALID_REQUEST without a request', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: '[]' }));
    const error = await apiWith(fetchImpl).createThread(knowledgeBase, { pageId: page, threadId: 'not-a-uuid', commentId, kind: 'issue', anchorKind: 'selection', bodyMd: 'x' }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('INVALID_REQUEST');
    expect(requests).toHaveLength(0);
  });
});

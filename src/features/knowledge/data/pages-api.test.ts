import { describe, expect, test } from 'bun:test';
import type { Page } from '@fob/shared/knowledge/contracts';
import { isKnowledgeDataError } from './errors';
import { createKnowledgePagesApi } from './pages-api';
import { knowledgeTrpcUrl } from './endpoint';

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const teamspace = 'a0000000-0000-4000-8000-00000000000a';

type CapturedRequest = { url: string; method: string; body?: string };

/** Drives the real @trpc/client link chain; responses use the U01-authoritative batch envelope. */
function capturingFetch(respond: () => { status: number; body: string }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : undefined });
    const { status, body } = respond();
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

function fullPage(overrides: Partial<Page> = {}): Page {
  return {
    id: '10000000-0000-4000-8000-000000000001',
    knowledgeBaseId: knowledgeBase,
    teamspaceId: teamspace,
    parentId: null,
    kind: 'doc',
    databaseId: null,
    title: '欢迎',
    icon: null,
    cover: null,
    properties: {},
    inheritsPermissions: true,
    position: '000003',
    path: '10000000_0000_4000_8000_000000000001',
    createdBy: '90000000-0000-4000-8000-000000000000',
    createdAt: '2026-09-26T00:00:00Z',
    updatedAt: '2026-09-26T00:00:00Z',
    deletedAt: null,
    ...overrides,
  };
}

const apiWith = (fetchImpl: typeof fetch) => createKnowledgePagesApi({ resolveOrigin: () => origin, fetchImpl });

describe('createKnowledgePagesApi · listPages', () => {
  test('queries page.list on the knowledgeBase transport URL and validates the pages through the contract', async () => {
    const page = fullPage();
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: [page] } }]) }));
    const pages = await apiWith(fetchImpl).listPages(knowledgeBase);
    expect(pages).toEqual([page]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/page.list?`)).toBe(true);
    expect(requests[0]!.url).toContain('batch=1');
    expect(decodeURIComponent(requests[0]!.url)).toContain(`"knowledgeBaseId":"${knowledgeBase}"`);
  });

  test('a payload the contract rejects is an UNAVAILABLE error, never rendered data', async () => {
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: [{ id: 'not-a-uuid' }] } }]) }));
    const error = await apiWith(fetchImpl).listPages(knowledgeBase).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
    expect((error as { message: string }).message).toContain('不符合契约');
  });
});

describe('createKnowledgePagesApi · mutations', () => {
  test('create POSTs the contract input and returns the validated placement', async () => {
    const placement = { pageId: '10000000-0000-4000-8000-000000000001', parentId: null, teamspaceId: teamspace, position: 'i00000', path: '10000000_0000_4000_8000_000000000001' };
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: placement } }]) }));
    const input = {
      id: placement.pageId,
      knowledgeBaseId: knowledgeBase,
      teamspaceId: teamspace,
      parentId: null,
      kind: 'doc' as const,
      databaseId: null,
      title: '',
      icon: null,
      cover: null,
      properties: {},
      inheritsPermissions: true,
      afterPageId: null,
    };
    const result = await apiWith(fetchImpl).createPage(knowledgeBase, input);
    expect(result).toEqual(placement);
    expect(requests[0]!.method).toBe('POST');
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/page.create?`)).toBe(true);
    expect(JSON.parse(requests[0]!.body!)).toEqual({ 0: input });
  });

  test('move, recycle and restore send their contract shapes', async () => {
    const movePlacement = { pageId: '10000000-0000-4000-8000-000000000001', parentId: null, teamspaceId: teamspace, position: 'i00000', path: 'x' };
    const lifecycle = { knowledgeBaseId: knowledgeBase, pageId: '10000000-0000-4000-8000-000000000001', deletedAt: '2026-09-26T01:00:00Z' };
    const queue = [
      { status: 200, body: JSON.stringify([{ result: { data: movePlacement } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: lifecycle } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: { ...lifecycle, deletedAt: null } } }]) },
    ];
    const { requests, fetchImpl } = capturingFetch(() => queue.shift()!);
    const api = apiWith(fetchImpl);

    await api.movePage(knowledgeBase, { pageId: movePlacement.pageId, parentId: null, teamspaceId: teamspace, afterPageId: null, operationId: '30000000-0000-4000-8000-000000000000' });
    await api.recyclePage(knowledgeBase, { pageId: lifecycle.pageId });
    await api.restorePage(knowledgeBase, { pageId: lifecycle.pageId });

    expect(requests.map((request) => request.url.split('/').pop()?.split('?')[0])).toEqual(['page.move', 'page.recycle', 'page.restore']);
    expect(JSON.parse(requests[0]!.body!)).toEqual({
      0: { knowledgeBaseId: knowledgeBase, pageId: movePlacement.pageId, parentId: null, teamspaceId: teamspace, afterPageId: null, operationId: '30000000-0000-4000-8000-000000000000' },
    });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, pageId: lifecycle.pageId } });
  });

  test('a missing procedure (the honest pre-route state) normalizes to NOT_FOUND', async () => {
    const { fetchImpl } = capturingFetch(() => ({
      status: 404,
      // The tRPC wire envelope: numeric transport code + the tRPC code in data.
      body: JSON.stringify([
        { error: { code: -32003, message: 'No procedure found on path "page.update"', data: { code: 'NOT_FOUND', httpStatus: 404, requestId: 'req-1' } } },
      ]),
    }));
    const error = await apiWith(fetchImpl).updatePage(knowledgeBase, { pageId: '10000000-0000-4000-8000-000000000001', title: 'x' }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('NOT_FOUND');
    expect((error as { requestId: string | null }).requestId).toBe('req-1');
  });

  test('contract-invalid inputs fail fast as INVALID_REQUEST without any request leaving', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: '[]' }));
    const error = await apiWith(fetchImpl).updatePage(knowledgeBase, { pageId: 'not-a-uuid', title: 'x' }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('INVALID_REQUEST');
    expect(requests).toHaveLength(0);
  });
});

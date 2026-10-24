import { describe, expect, test } from 'bun:test';
import { knowledgeTrpcUrl } from '../data/endpoint';
import { isKnowledgeDataError } from '../data/errors';
import { createKnowledgeDatabasesApi } from './database-api';

const origin = 'https://api.fob.example';
const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const database = '10000000-0000-4000-8000-00000000000d';
const row = '10000000-0000-4000-8000-0000000000e1';

type CapturedRequest = { url: string; method: string; body?: string };

/** 驱动真实 @trpc/client link 链；响应用 U01 权威的批信封。 */
function capturingFetch(respond: () => { status: number; body: string }) {
  const requests: CapturedRequest[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: (init?.method ?? 'GET').toUpperCase(), body: typeof init?.body === 'string' ? init.body : undefined });
    const { status, body } = respond();
    return new Response(body, { status, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { requests, fetchImpl };
}

const apiWith = (fetchImpl: typeof fetch) => createKnowledgeDatabasesApi({ resolveOrigin: () => origin, fetchImpl });

const columnsState = { knowledgeBaseId: knowledgeBase, pageId: database, columns: [{ id: 'c1', name: '状态', type: 'text' as const }] };
const rowsPage = { rows: [{ pageId: row, title: '首行', properties: { c1: '进行中' } }], nextCursor: null };

describe('database-api · 查询', () => {
  test('getColumns GET 于 knowledgeBase 传输 URL 并过契约校验', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: columnsState } }]) }));
    const result = await apiWith(fetchImpl).getColumns(knowledgeBase, { pageId: database });
    expect(result).toEqual(columnsState);
    expect(requests[0]!.method).toBe('GET');
    expect(requests[0]!.url.startsWith(`${knowledgeTrpcUrl(origin, knowledgeBase)}/database.getColumns?`)).toBe(true);
  });

  test('listRows GET 携带 filters/sort/cursor/limit 并通过契约', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: rowsPage } }]) }));
    const result = await apiWith(fetchImpl).listRows(knowledgeBase, {
      databaseId: database,
      filters: [{ propertyId: 'c1', operator: 'contains', value: '进行' }],
      sort: [{ propertyId: 'c1', direction: 'asc' }],
      cursor: row,
      limit: 50,
    });
    expect(result).toEqual(rowsPage);
    const url = decodeURIComponent(requests[0]!.url);
    expect(url).toContain('database.listRows');
    expect(url).toContain('"operator":"contains"');
    expect(url).toContain('"direction":"asc"');
  });

  test('契约拒绝的响应归一 UNAVAILABLE，永不渲染', async () => {
    const { fetchImpl } = capturingFetch(() => ({ status: 200, body: JSON.stringify([{ result: { data: { rows: [{ pageId: 'not-a-uuid' }] } } }]) }));
    const error = await apiWith(fetchImpl).listRows(knowledgeBase, { databaseId: database, filters: [], sort: [], limit: 50 }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('UNAVAILABLE');
    expect((error as { message: string }).message).toContain('不符合契约');
  });
});

describe('database-api · 变更', () => {
  test('createRow / updateRowProperties / updateColumns POST 契约形体', async () => {
    const placement = { pageId: row, parentId: database, teamspaceId: 'a0000000-0000-4000-8000-00000000000a', position: 'i00000', path: 'x' };
    const queue = [
      { status: 200, body: JSON.stringify([{ result: { data: placement } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: { knowledgeBaseId: knowledgeBase, pageId: row, properties: { c1: '完成' } } } }]) },
      { status: 200, body: JSON.stringify([{ result: { data: columnsState } }]) },
    ];
    const { requests, fetchImpl } = capturingFetch(() => queue.shift()!);
    const api = apiWith(fetchImpl);

    const created = await api.createRow(knowledgeBase, {
      id: row, knowledgeBaseId: knowledgeBase, databaseId: database, title: '首行', properties: {}, icon: null, cover: null, inheritsPermissions: true, afterPageId: null,
    });
    expect(created).toEqual(placement);
    const operationId = '30000000-0000-4000-8000-000000000000';
    await api.updateRowProperties(knowledgeBase, { pageId: row, properties: { c1: '完成' }, operationId });
    await api.updateColumns(knowledgeBase, { pageId: database, columns: columnsState.columns });

    expect(requests.map((request) => request.url.split('/').pop()?.split('?')[0])).toEqual(['database.createRow', 'database.updateRowProperties', 'database.updateColumns']);
    expect(JSON.parse(requests[1]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, pageId: row, properties: { c1: '完成' }, operationId } });
    expect(JSON.parse(requests[2]!.body!)).toEqual({ 0: { knowledgeBaseId: knowledgeBase, pageId: database, columns: columnsState.columns } });
  });

  test('未装配路由（诚实前置状态）归一 NOT_FOUND', async () => {
    const { fetchImpl } = capturingFetch(() => ({
      status: 404,
      body: JSON.stringify([{ error: { code: -32003, message: 'No procedure found on path "database.getColumns"', data: { code: 'NOT_FOUND', httpStatus: 404, requestId: 'req-1' } } }]),
    }));
    const error = await apiWith(fetchImpl).getColumns(knowledgeBase, { pageId: database }).catch((cause: unknown) => cause);
    expect(isKnowledgeDataError(error)).toBe(true);
    expect((error as { code: string }).code).toBe('NOT_FOUND');
    expect((error as { requestId: string | null }).requestId).toBe('req-1');
  });

  test('契约非法输入在任何请求发出前 INVALID_REQUEST 快速失败', async () => {
    const { requests, fetchImpl } = capturingFetch(() => ({ status: 200, body: '[]' }));
    const api = apiWith(fetchImpl);
    const cases: Promise<unknown>[] = [
      api.listRows(knowledgeBase, { databaseId: database, filters: [{ propertyId: 'c1', operator: 'eq' }], sort: [], limit: 50 }),
      api.createRow(knowledgeBase, { id: row, knowledgeBaseId: knowledgeBase, databaseId: database, title: '', properties: { bad: { nested: 1 } } as never, icon: null, cover: null, inheritsPermissions: true, afterPageId: null }),
      api.updateColumns(knowledgeBase, { pageId: 'not-a-uuid', columns: [] as never[] }),
    ];
    for (const pending of cases) {
      const error = await pending.catch((cause: unknown) => cause);
      expect(isKnowledgeDataError(error)).toBe(true);
      expect((error as { code: string }).code).toBe('INVALID_REQUEST');
    }
    expect(requests).toHaveLength(0);
  });
});

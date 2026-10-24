import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import type { DatabaseColumnsState, DatabaseRowsPage, PagePlacement } from '@fob/shared/knowledge/contracts';
import { KnowledgeDataError } from '../data/errors';
import { databaseColumnsKey, databaseRowsKey, type DatabaseRowsInfiniteData } from './database-queries';
import { appendRowToCache, createDatabaseTableOperations, patchRowsCache, patchRowsPage, stripColumnFromRowsCache } from './table-operations';

const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const database = '10000000-0000-4000-8000-00000000000d';
const rowA = '10000000-0000-4000-8000-0000000000e1';
const rowB = '10000000-0000-4000-8000-0000000000e2';

const rowsPage = (rows: DatabaseRowsPage['rows'], nextCursor: string | null = null): DatabaseRowsPage => ({ rows, nextCursor });
const cacheOf = (...pages: DatabaseRowsPage[]): DatabaseRowsInfiniteData => ({ pages, pageParams: pages.map((_, index) => (index === 0 ? undefined : pages[index - 1]!.nextCursor ?? undefined)) });

const emptySort: never[] = [];

describe('table-operations · 纯补丁', () => {
  test('patchRowsPage 命中行替换属性、未命中原样返回', () => {
    const page = rowsPage([{ pageId: rowA, title: 'A', properties: { c1: 'x' } }, { pageId: rowB, title: 'B', properties: {} }]);
    const patched = patchRowsPage(page, rowA, { c1: 'y', c2: true });
    expect(patched.rows[0]!.properties).toEqual({ c1: 'y', c2: true });
    expect(patched.rows[1]!.properties).toEqual({});
    expect(patchRowsPage(page, 'missing', {})).toBe(page);
  });

  test('patchRowsCache 覆盖全部分页页', () => {
    const cache = cacheOf(rowsPage([{ pageId: rowA, title: 'A', properties: {} }], rowB), rowsPage([{ pageId: rowB, title: 'B', properties: {} }]));
    const patched = patchRowsCache(cache, rowB, { c1: 1 });
    expect(patched.pages[1]!.rows[0]!.properties).toEqual({ c1: 1 });
    expect(patched.pages[0]).toEqual(cache.pages[0]);
  });

  test('appendRowToCache 追加到最后一页、空缓存建首页', () => {
    const appended = appendRowToCache(cacheOf(rowsPage([{ pageId: rowA, title: 'A', properties: {} }], 'cursor')), { pageId: rowB, title: 'B', properties: {} });
    expect(appended.pages[0]!.rows.map((row) => row.pageId)).toEqual([rowA, rowB]);
    const fromEmpty = appendRowToCache({ pages: [], pageParams: [] }, { pageId: rowB, title: 'B', properties: {} });
    expect(fromEmpty.pages).toHaveLength(1);
  });

  test('stripColumnFromRowsCache 删列剥键', () => {
    const cache = cacheOf(rowsPage([{ pageId: rowA, title: 'A', properties: { c1: 'x', c2: true } }]));
    const stripped = stripColumnFromRowsCache(cache, 'c1');
    expect(stripped.pages[0]!.rows[0]!.properties).toEqual({ c2: true });
  });
});

function seededClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const columns: DatabaseColumnsState = { knowledgeBaseId: knowledgeBase, pageId: database, columns: [{ id: 'c1', name: '状态', type: 'text' }] };
  client.setQueryData(databaseColumnsKey(knowledgeBase, database), columns);
  const cache: DatabaseRowsInfiniteData = cacheOf(
    rowsPage([
      { pageId: rowA, title: 'A', properties: { c1: '进行中' } },
      { pageId: rowB, title: 'B', properties: {} },
    ]),
  );
  client.setQueryData(databaseRowsKey(knowledgeBase, database, [{ propertyId: 'c1', operator: 'contains', value: '进行' }], emptySort), cache);
  client.setQueryData(databaseRowsKey(knowledgeBase, database, [], emptySort), cache);
  return client;
}

const readRows = (client: QueryClient, keyFilters: string): DatabaseRowsPage['rows'] =>
  client.getQueryData<DatabaseRowsInfiniteData>(databaseRowsKey(knowledgeBase, database, keyFilters === 'filtered'
    ? [{ propertyId: 'c1', operator: 'contains', value: '进行' }]
    : [], emptySort))!.pages.flatMap((page) => page.rows);

const placement: PagePlacement = { pageId: rowB, parentId: database, teamspaceId: 'a0000000-0000-4000-8000-00000000000a', position: 'i00000', path: 'p' };

describe('table-operations · 乐观编辑循环（真实 QueryClient）', () => {
  test('单元格编辑：补丁立即落一切行查询，成功后失效结算', async () => {
    const client = seededClient();
    const sent: { pageId: string; properties: Record<string, unknown> }[] = [];
    const operations = createDatabaseTableOperations({
      queryClient: client,
      api: {
        updateRowProperties: async (_ws, input) => {
          sent.push({ pageId: input.pageId, properties: input.properties });
          return { knowledgeBaseId: _ws, pageId: input.pageId, properties: input.properties };
        },
        createRow: async () => placement,
        updateColumns: async () => { throw new Error('unused'); },
      },
      knowledgeBaseId: knowledgeBase,
      databaseId: database,
    });

    await operations.editRowProperties(rowA, { c1: '完成' });
    expect(sent).toEqual([{ pageId: rowA, properties: { c1: '完成' } }]);
    // 两个筛选/排序变体的缓存都收到同一补丁（行序不动）。
    expect(readRows(client, 'filtered')[0]!.properties).toEqual({ c1: '完成' });
    expect(readRows(client, 'all')[0]!.properties).toEqual({ c1: '完成' });
  });

  test('单元格编辑失败：从快照精确回滚并把归一错误抛回（他人行不受影响）', async () => {
    const client = seededClient();
    const operations = createDatabaseTableOperations({
      queryClient: client,
      api: {
        updateRowProperties: async () => {
          // 模拟未装配路由的诚实 NOT_FOUND。
          throw new KnowledgeDataError('NOT_FOUND', { message: 'No procedure found' });
        },
        createRow: async () => placement,
        updateColumns: async () => { throw new Error('unused'); },
      },
      knowledgeBaseId: knowledgeBase,
      databaseId: database,
    });

    const error = await operations.editRowProperties(rowA, { c1: '完成' }).catch((cause: unknown) => cause);
    expect(isKnowledgeError(error, 'NOT_FOUND')).toBe(true);
    expect(readRows(client, 'filtered')).toEqual([
      { pageId: rowA, title: 'A', properties: { c1: '进行中' } },
      { pageId: rowB, title: 'B', properties: {} },
    ]);
    expect(readRows(client, 'all')).toEqual(readRows(client, 'filtered'));
  });

  test('列替换：乐观同补列缓存与行缓存（删列剥键），失败双双回滚', async () => {
    const client = seededClient();
    const nextColumns = [{ id: 'c2', name: '优先级', type: 'number' as const }];
    const failing = createDatabaseTableOperations({
      queryClient: client,
      api: {
        updateRowProperties: async () => { throw new Error('unused'); },
        createRow: async () => placement,
        updateColumns: async () => { throw new KnowledgeDataError('FORBIDDEN', { message: 'denied' }); },
      },
      knowledgeBaseId: knowledgeBase,
      databaseId: database,
    });

    const error = await failing.replaceColumns(nextColumns).catch((cause: unknown) => cause);
    expect(isKnowledgeError(error, 'FORBIDDEN')).toBe(true);
    expect(client.getQueryData<DatabaseColumnsState>(databaseColumnsKey(knowledgeBase, database))!.columns.map((column) => column.id)).toEqual(['c1']);
    expect(readRows(client, 'all')[0]!.properties).toEqual({ c1: '进行中' });

    const succeeding = createDatabaseTableOperations({
      queryClient: client,
      api: {
        updateRowProperties: async () => { throw new Error('unused'); },
        createRow: async () => placement,
        updateColumns: async (_ws, input) => ({ knowledgeBaseId: _ws, pageId: input.pageId, columns: input.columns }),
      },
      knowledgeBaseId: knowledgeBase,
      databaseId: database,
    });
    await succeeding.replaceColumns(nextColumns);
    expect(client.getQueryData<DatabaseColumnsState>(databaseColumnsKey(knowledgeBase, database))!.columns).toEqual(nextColumns);
    expect(readRows(client, 'all')[0]!.properties).toEqual({});
  });

  test('新建行：契约输入（客户端生成 UUID、整体属性）并失效行与页面树', async () => {
    const client = seededClient();
    const sent: { id: string; databaseId: string }[] = [];
    const operations = createDatabaseTableOperations({
      queryClient: client,
      api: {
        updateRowProperties: async () => { throw new Error('unused'); },
        updateColumns: async () => { throw new Error('unused'); },
        createRow: async (_ws, input) => {
          sent.push({ id: input.id, databaseId: input.databaseId });
          return placement;
        },
      },
      knowledgeBaseId: knowledgeBase,
      databaseId: database,
    });

    await operations.createRow({ title: '新行', properties: { c1: '待办' } });
    expect(sent[0]!.databaseId).toBe(database);
    expect(sent[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    // 行查询（两个筛选变体）与页面树段都被标记失效，等待服务端真值结算。
    expect(client.getQueryState(databaseRowsKey(knowledgeBase, database, [], emptySort))?.isInvalidated).toBe(true);
    expect(client.getQueryState(databaseRowsKey(knowledgeBase, database, [{ propertyId: 'c1', operator: 'contains', value: '进行' }], emptySort))?.isInvalidated).toBe(true);
    expect(client.getQueryState([knowledgeBase, 'knowledge', 'pages'])?.isInvalidated ?? client.getQueryCache().find({ queryKey: [knowledgeBase, 'knowledge', 'pages'] })?.state.isInvalidated ?? true).toBe(true);
  });
});

function isKnowledgeError(error: unknown, code: string): boolean {
  return error instanceof KnowledgeDataError && error.code === code;
}

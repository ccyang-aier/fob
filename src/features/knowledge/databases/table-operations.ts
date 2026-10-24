/**
 * 表格写操作控制器（U06）——单元格属性编辑、建行与列替换的乐观循环。
 *
 * 与 U03 tree-operations 同一契约：变更先落在 U01 缓存上（本地立即可见），
 * 失败从快照精确回滚并把原因抛回 UI，成功后失效对应查询让服务端真值结算。
 * 控制器持有可注入的 api 与 QueryClient，纯补丁函数独立可测；B06
 * `database.rows.changed` 事件到达引发的并发重取，最终也经同一失效前缀收敛。
 */

import type { QueryClient } from '@tanstack/react-query';
import type { DatabaseColumnsState, DatabaseRowsPage, PagePlacement, Properties, PropertyDefinition } from '@fob/shared/knowledge/contracts';
import type { KnowledgeDatabasesApi } from './database-api';
import { databaseColumnsKey, databaseRowsRootKey, type DatabaseRowsInfiniteData } from './database-queries';

// ── 纯补丁 ──

/** 单页行数据中补一行属性（页面 ID 不存在时原样返回——回滚并发删除是安全的 no-op）。 */
export function patchRowsPage(page: DatabaseRowsPage, pageId: string, properties: Properties): DatabaseRowsPage {
  if (!page.rows.some((row) => row.pageId === pageId)) return page;
  return { ...page, rows: page.rows.map((row) => (row.pageId === pageId ? { ...row, properties } : row)) };
}

export function patchRowsCache(cache: DatabaseRowsInfiniteData, pageId: string, properties: Properties): DatabaseRowsInfiniteData {
  return { ...cache, pages: cache.pages.map((page) => patchRowsPage(page, pageId, properties)) };
}

/** 追加一行（新建行的乐观占位，出现在当前已加载的最后一页）。 */
export function appendRowToCache(cache: DatabaseRowsInfiniteData, row: DatabaseRowsPage['rows'][number]): DatabaseRowsInfiniteData {
  if (cache.pages.length === 0) return { pages: [{ rows: [row], nextCursor: null }], pageParams: [undefined] };
  const pages = [...cache.pages];
  pages[pages.length - 1] = { ...pages[pages.length - 1]!, rows: [...pages[pages.length - 1]!.rows, row] };
  return { ...cache, pages };
}

/** 删列后行缓存同步剥离该键（服务端在同一事务内对所有行做同样清理）。 */
export function stripColumnFromRowsCache(cache: DatabaseRowsInfiniteData, columnId: string): DatabaseRowsInfiniteData {
  return {
    ...cache,
    pages: cache.pages.map((page) => ({
      ...page,
      rows: page.rows.map((row) => {
        if (!(columnId in row.properties)) return row;
        const next = { ...row.properties };
        delete next[columnId];
        return { ...row, properties: next };
      }),
    })),
  };
}

// ── 控制器 ──

export interface DatabaseTableOperationsDeps {
  queryClient: QueryClient;
  api: Pick<KnowledgeDatabasesApi, 'updateRowProperties' | 'createRow' | 'updateColumns'>;
  knowledgeBaseId: string;
  databaseId: string;
}

export type OperationFailure = { code: string; message: string };

export function createDatabaseTableOperations(deps: DatabaseTableOperationsDeps) {
  const { queryClient, api, knowledgeBaseId, databaseId } = deps;
  const rowsRoot = databaseRowsRootKey(knowledgeBaseId, databaseId);
  const columnsKey = databaseColumnsKey(knowledgeBaseId, databaseId);

  return {
    /**
     * 单元格属性编辑：补丁先落一切行查询（保持行序不动，排序由服务端结算），
     * 失败从快照逐键回滚后把归一错误抛回。
     */
    async editRowProperties(pageId: string, nextProperties: Properties): Promise<void> {
      await queryClient.cancelQueries({ queryKey: rowsRoot });
      const snapshots = queryClient.getQueriesData<DatabaseRowsInfiniteData>({ queryKey: rowsRoot });
      for (const [key] of snapshots) {
        queryClient.setQueryData<DatabaseRowsInfiniteData>(key, (cache) => (cache ? patchRowsCache(cache, pageId, nextProperties) : cache));
      }
      try {
        await api.updateRowProperties(knowledgeBaseId, { pageId, properties: nextProperties, operationId: crypto.randomUUID() });
      } catch (cause) {
        for (const [key, cache] of snapshots) queryClient.setQueryData(key, cache);
        throw cause;
      } finally {
        void queryClient.invalidateQueries({ queryKey: rowsRoot });
      }
    },

    /** 新建行：成功后失效行查询与页面树（行是页面，树上会出现子页）。 */
    async createRow(input: { title: string; properties?: Properties }): Promise<PagePlacement> {
      const id = crypto.randomUUID();
      const placement = await api.createRow(knowledgeBaseId, {
        id,
        knowledgeBaseId,
        title: input.title,
        properties: input.properties ?? {},
        icon: null,
        cover: null,
        inheritsPermissions: true,
        afterPageId: null,
        databaseId,
      });
      await queryClient.invalidateQueries({ queryKey: rowsRoot });
      await queryClient.invalidateQueries({ queryKey: [knowledgeBaseId, 'knowledge', 'pages'] });
      return placement;
    },

    /**
     * 列定义整体替换：乐观同时补列缓存（新定义）与行缓存（删列剥键），
     * 失败两者各自回滚。成功后列与行都失效——行属性清理由服务端事务结算。
     */
    async replaceColumns(nextColumns: PropertyDefinition[]): Promise<DatabaseColumnsState> {
      await queryClient.cancelQueries({ queryKey: columnsKey });
      await queryClient.cancelQueries({ queryKey: rowsRoot });
      const columnsSnapshot = queryClient.getQueryData<DatabaseColumnsState>(columnsKey);
      const rowsSnapshots = queryClient.getQueriesData<DatabaseRowsInfiniteData>({ queryKey: rowsRoot });
      const previousColumns = columnsSnapshot?.columns ?? [];
      const removed = previousColumns.filter((column) => !nextColumns.some((candidate) => candidate.id === column.id)).map((column) => column.id);
      queryClient.setQueryData<DatabaseColumnsState>(columnsKey, (cache) => (cache ? { ...cache, columns: nextColumns } : cache));
      if (removed.length) {
        for (const [key] of rowsSnapshots) {
          queryClient.setQueryData<DatabaseRowsInfiniteData>(key, (cache) => {
            if (!cache) return cache;
            return removed.reduce((working, columnId) => stripColumnFromRowsCache(working, columnId), cache);
          });
        }
      }
      try {
        return await api.updateColumns(knowledgeBaseId, { pageId: databaseId, columns: nextColumns });
      } catch (cause) {
        if (columnsSnapshot !== undefined) queryClient.setQueryData(columnsKey, columnsSnapshot);
        for (const [key, cache] of rowsSnapshots) queryClient.setQueryData(key, cache);
        throw cause;
      } finally {
        void queryClient.invalidateQueries({ queryKey: columnsKey });
        void queryClient.invalidateQueries({ queryKey: rowsRoot });
      }
    },
  };
}

export type DatabaseTableOperations = ReturnType<typeof createDatabaseTableOperations>;

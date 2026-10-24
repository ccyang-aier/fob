'use client';

/**
 * 数据库查询钩子（U06）——U01 缓存语义下的列 schema 与行分页查询。
 *
 * 键约定：全部挂在 `knowledgeQueryKeys.databases(knowledgeBaseId)` 段下（B06
 * `database.rows.changed` 事件即失效该段），行查询把 filters/sort 编进键尾部，
 * 筛选排序变化即换键重取；cursor 分页用 useInfiniteQuery，placeholderData
 * keepPreviousData 让筛选切换不闪空白。
 */

import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { knowledgeDatabasesApi } from './database-api';
import { filtersKeyPart, sortKeyPart, type SortKey } from './query-state';
import type { DatabaseFilter } from '@fob/shared/knowledge/contracts';

/** 列 schema：[ws, knowledge, databases, columns, dbId]；整体替换语义。 */
export function databaseColumnsKey(knowledgeBaseId: string, databaseId: string) {
  return [knowledgeBaseId, 'knowledge', 'databases', 'columns', databaseId] as const;
}

/** 行分页：[ws, knowledge, databases, rows, dbId, filters, sort]；cursor 保持在分页状态内。 */
export function databaseRowsKey(knowledgeBaseId: string, databaseId: string, filters: readonly DatabaseFilter[], sort: readonly SortKey[]) {
  return [knowledgeBaseId, 'knowledge', 'databases', 'rows', databaseId, filtersKeyPart(filters), sortKeyPart(sort)] as const;
}

/** 该库全部行查询的公共前缀（乐观补丁按前缀匹配一切筛选/排序组合）。 */
export function databaseRowsRootKey(knowledgeBaseId: string, databaseId: string) {
  return [knowledgeBaseId, 'knowledge', 'databases', 'rows', databaseId] as const;
}

export function useDatabaseColumnsQuery(knowledgeBaseId: string, databaseId: string | null) {
  return useQuery({
    queryKey: databaseColumnsKey(knowledgeBaseId, databaseId ?? 'none'),
    queryFn: ({ signal }) => knowledgeDatabasesApi.getColumns(knowledgeBaseId, { pageId: databaseId! }, signal),
    enabled: databaseId !== null,
  });
}

export type DatabaseRowsInfiniteData = {
  pages: import('@fob/shared/knowledge/contracts').DatabaseRowsPage[];
  pageParams: (string | undefined)[];
};

export function useDatabaseRowsQuery(
  knowledgeBaseId: string,
  databaseId: string | null,
  filters: readonly DatabaseFilter[],
  sort: readonly SortKey[],
) {
  return useInfiniteQuery({
    queryKey: databaseRowsKey(knowledgeBaseId, databaseId ?? 'none', filters, sort),
    queryFn: ({ pageParam, signal }) =>
      knowledgeDatabasesApi.listRows(knowledgeBaseId, { databaseId: databaseId!, filters: [...filters], sort: sort.map((key) => ({ propertyId: key.propertyId, direction: key.direction })), cursor: pageParam, limit: 50 }, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: databaseId !== null,
    placeholderData: keepPreviousData,
  });
}

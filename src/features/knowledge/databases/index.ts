/**
 * 数据库表格视图（U06）——kind=database 页面的表格视图模块。
 *
 * 挂载约定（由应用壳在页面分派处接入）：
 *
 * ```tsx
 * import { DatabaseTableView } from '@/features/knowledge/databases';
 *
 * page.kind === 'database' ? (
 *   <DatabaseTableView
 *     scope={{ knowledgeBaseId, pageId }}
 *     title={page.title}
 *     icon={page.icon}
 *     onOpenRow={(rowPageId) => selectPage(rowPageId)}
 *   />
 * ) : (
 *   <KnowledgePageEditor scope={{ knowledgeBaseId, pageId }} />
 * )
 * ```
 *
 * 视图自带授权门（page.access，与编辑器共用缓存键）与四态（加载 / 无权 / 空 /
 * 错误），调用方只需提供页面 scope 与打开行正文的导航回调。
 */

export { DatabaseTableView } from './database-table-view';
export { createKnowledgeDatabasesApi, knowledgeDatabasesApi } from './database-api';
export type { KnowledgeDatabasesApi, UpdateRowPropertiesInput } from './database-api';
export { useDatabaseColumnsQuery, useDatabaseRowsQuery, databaseColumnsKey, databaseRowsKey, databaseRowsRootKey } from './database-queries';
export { createDatabaseTableOperations, patchRowsCache, patchRowsPage, stripColumnFromRowsCache, appendRowToCache } from './table-operations';
export type { DatabaseTableOperations } from './table-operations';
export { operatorsForType, defaultOperatorForType, buildFilter, toggleSort, setSortDirection, pruneQueryState, toRowsQuery } from './query-state';
export type { FilterOperator, SortKey, SortDirection } from './query-state';
export { commitCellEdit, cellDisplayText, isCellEmpty, validateColumnsReplacement, appendColumn, renameColumn, removeColumn, setColumnOptions } from './cell-model';
export { gridActionFor, moveGridCursorColumns, moveGridCursorRows, advanceGridCursor } from './grid-navigation';
export type { GridCursor, GridSize, GridAction } from './grid-navigation';

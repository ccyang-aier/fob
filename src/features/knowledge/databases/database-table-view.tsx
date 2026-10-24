'use client';

import { useUiMessage } from '../ui-message';
import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './database-table-view.messages';
/**
 * 数据库表格视图（U06）——kind=database 页面的表格视图容器。
 *
 * 一次 `page.access` 授权（与编辑器共用缓存键）决定四态的第一刀：pending /
 * error / denied / granted。授予后列 schema 与行分页经 U01 缓存查询、写路径走
 * table-operations 的乐观回路；筛选排序状态驱动查询键、变化即服务端重取。
 * 行即页面：点击行名进入行正文（onOpenRow）。列结构变更需要 full 级，单元格
 * 编辑需要 edit 级；后端路由未装配时（Z03 前置）如实呈现 NOT_FOUND，不伪造。
 */

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleNotch, Plus, Table } from '@phosphor-icons/react';
import type {
  DatabaseFilter,
  PageScope,
  PermissionLevel,
  Properties,
  PropertyDefinition,
} from '@fob/shared/knowledge/contracts';
import { runKnowledgeCall } from '../data/trpc-client';
import { knowledgeErrorCodeOf } from '../entry-state';
import { CanvasError, CanvasForbidden, CanvasSpinner, CanvasState } from '../canvas-states';
import { organizationQueryKeys } from '../organization/keys';
import { organizationClient } from '@/features/knowledge/organization/client';
import { knowledgeDatabasesApi } from './database-api';
import { useDatabaseColumnsQuery, useDatabaseRowsQuery } from './database-queries';
import { pruneQueryState, toggleSort, type SortKey } from './query-state';
import { createDatabaseTableOperations } from './table-operations';
import { TableGrid } from './table-grid';
import { FilterSortBar } from './filter-sort-bar';
import { personNameOfFactory } from './table-cells';
import type { PersonOption } from './table-cells';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import {
  appendColumn,
  columnsEditFailureText,
  removeColumn as removeColumnPure,
  renameColumn as renameColumnPure,
  setColumnOptions,
  validateColumnsReplacement,
} from './cell-model';
import { EditOptionsPanel } from './table-header';
import type { ColumnDraft } from './table-header';
import type { AnchorRect } from './anchored-panel';

const levelRank: Record<PermissionLevel, number> = { view: 0, comment: 1, edit: 2, full: 3 };
const levelSatisfies = (level: PermissionLevel, required: PermissionLevel) =>
  levelRank[level] >= levelRank[required];

/** 与编辑器 page-access 同键共用缓存：同一页面的授权结论只问一次。 */
function databaseAccessQueryKey(knowledgeBaseId: string, pageId: string) {
  return [knowledgeBaseId, 'knowledge', 'pages', 'access', pageId] as const;
}

function accessErrorCopy(locale?: Locale): Record<string, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    UNAVAILABLE: knowledgeT('knowledgeServiceUnavailableRetryLater'),
    NETWORK: knowledgeT('unableToConnectToKnowledgeServiceCheckYour'),
    TIMEOUT: knowledgeT('knowledgeServiceConnectionTimedOutPleaseRetry'),
    RATE_LIMITED: knowledgeT('tooManyRequestsRetryLater'),
    ENDPOINT: knowledgeT('knowledgeServiceAddressIsNotConfigured'),
    PAYMENT_REQUIRED: knowledgeT('thisActionRequiresAHigherAccessLevel'),
  };
}

export function DatabaseTableView({
  scope,
  title,
  icon,
  onOpenRow,
}: {
  scope: PageScope;
  /** 页面元数据（挂载方从页面树提供；缺省时头部仅显示视图名）。 */
  title?: string;
  icon?: string | null;
  onOpenRow: (pageId: string) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<DatabaseFilter[]>([]);
  const [sort, setSort] = useState<SortKey[]>([]);
  const [pendingRowIds, setPendingRowIds] = useState<ReadonlySet<string>>(new Set());
  const [creatingRow, setCreatingRow] = useState(false);
  const [failureText, setFailureText] = useUiMessage(knowledgeMessages, null);
  const [filterFocusColumnId, setFilterFocusColumnId] = useState<string | null>(null);
  const [optionsEditor, setOptionsEditor] = useState<{
    column: PropertyDefinition;
    anchor: AnchorRect;
  } | null>(null);

  // ── 授权门 ───────────────────────────────────────────────
  const accessQuery = useQuery({
    queryKey: databaseAccessQueryKey(scope.knowledgeBaseId, scope.pageId),
    queryFn: ({ signal }) =>
      runKnowledgeCall(scope.knowledgeBaseId, signal, (client) =>
        client.page.access.query(
          { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, action: 'view' },
          { signal },
        ),
      ),
    enabled: scope.knowledgeBaseId.length > 0 && scope.pageId.length > 0,
  });
  const level: PermissionLevel | null = accessQuery.data?.authorized
    ? accessQuery.data.level
    : null;
  const canEditCells = level !== null && levelSatisfies(level, 'edit');
  const canEditColumns = level !== null && levelSatisfies(level, 'full');

  // ── 数据 ─────────────────────────────────────────────────
  const columnsQuery = useDatabaseColumnsQuery(
    scope.knowledgeBaseId,
    accessQuery.data?.authorized ? scope.pageId : null,
  );
  const columns = useMemo(() => columnsQuery.data?.columns ?? [], [columnsQuery.data]);
  const rowsQuery = useDatabaseRowsQuery(
    scope.knowledgeBaseId,
    accessQuery.data?.authorized ? scope.pageId : null,
    filters,
    sort,
  );
  const rows = useMemo(
    () => rowsQuery.data?.pages.flatMap((page) => page.rows) ?? [],
    [rowsQuery.data],
  );
  const loadedCount = rows.length;

  // 列删除后摘除指向旧列的筛选/排序（服务端会拒绝陈旧查询）。这是「渲染期间
  // 对齐状态」：以 columns 身份为界一次性收敛，React 会丢弃未提交的渲染直接
  // 重渲，不引入 effect 级联。
  const [prunedForColumns, setPrunedForColumns] = useState(columns);
  if (prunedForColumns !== columns) {
    setPrunedForColumns(columns);
    const pruned = pruneQueryState(filters, sort, columns);
    if (pruned.filters.length !== filters.length || pruned.sort.length !== sort.length) {
      setFilters(pruned.filters);
      setSort(pruned.sort);
    }
  }

  const membersQuery = useQuery({
    queryKey: organizationQueryKeys.members(scope.knowledgeBaseId),
    queryFn: ({ signal }) =>
      organizationClient.listMembers(scope.knowledgeBaseId, { limit: 100, signal }),
    enabled: accessQuery.data?.authorized === true,
    staleTime: 60_000,
  });
  const members: PersonOption[] = useMemo(
    () =>
      (membersQuery.data?.items ?? []).map((member) => ({
        userId: member.userId,
        name: member.name,
        email: member.email,
      })),
    [membersQuery.data],
  );
  const personNameOf = useMemo(() => personNameOfFactory(members), [members]);

  const operations = useMemo(
    () =>
      createDatabaseTableOperations({
        queryClient,
        api: knowledgeDatabasesApi,
        knowledgeBaseId: scope.knowledgeBaseId,
        databaseId: scope.pageId,
      }),
    [queryClient, scope.knowledgeBaseId, scope.pageId],
  );

  const trackFailure = (cause: unknown, what: string) => {
    const code = knowledgeErrorCodeOf(cause);
    const copy =
      code && accessErrorCopy(locale)[code]
        ? accessErrorCopy(locale)[code]
        : cause instanceof Error && cause.message
          ? cause.message
          : knowledgeT('actionFailedPleaseRetry');
    setFailureText({
      key: 'valueFailedValueValuePreviousValuesRestored',
      values: { v0: what, v1: code ? `（${code}）` : '', v2: copy },
    });
  };

  const editProperties = async (pageId: string, properties: Properties) => {
    setPendingRowIds((current) => new Set(current).add(pageId));
    try {
      await operations.editRowProperties(pageId, properties);
      setFailureText(null);
    } catch (cause) {
      trackFailure(cause, knowledgeT('editCell'));
    } finally {
      setPendingRowIds((current) => {
        const next = new Set(current);
        next.delete(pageId);
        return next;
      });
    }
  };

  const replaceColumns = async (nextColumns: PropertyDefinition[], what: string) => {
    const check = validateColumnsReplacement(columns, nextColumns);
    if (!check.ok) {
      setFailureText({
        key: 'valueFailedValue',
        values: { v0: what, v1: columnsEditFailureText(locale)[check.failure.kind] },
      });
      return;
    }
    try {
      await operations.replaceColumns(nextColumns);
      setFailureText(null);
    } catch (cause) {
      trackFailure(cause, what);
    }
  };

  const createRow = async () => {
    setCreatingRow(true);
    try {
      await operations.createRow({ title: '' });
      setFailureText(null);
    } catch (cause) {
      trackFailure(cause, knowledgeT('newRow'));
    } finally {
      setCreatingRow(false);
    }
  };

  // ── 四态裁决 ─────────────────────────────────────────────
  if (accessQuery.isPending) {
    return <CanvasSpinner label={knowledgeT('checkingPageAccess')} />;
  }
  if (accessQuery.isError) {
    return (
      <CanvasError
        title={knowledgeT('unableToVerifyPageAccess')}
        detail={
          accessErrorCopy(locale)[knowledgeErrorCodeOf(accessQuery.error) ?? ''] ??
          knowledgeT('unableToVerifyPageAccessPleaseRetry')
        }
        onRetry={() => void accessQuery.refetch()}
      />
    );
  }
  if (!accessQuery.data?.authorized) {
    return (
      <CanvasForbidden
        title={knowledgeT('youDoNotHaveAccessToThisDatabase')}
        detail={knowledgeT('yourCredentialsCannotViewThisPageContactIts')}
      />
    );
  }

  const loadError = columnsQuery.error ?? rowsQuery.error;
  if (loadError) {
    const code = knowledgeErrorCodeOf(loadError);
    if (code === 'FORBIDDEN' || code === 'UNAUTHENTICATED') {
      return (
        <CanvasForbidden
          title={knowledgeT('youDoNotHaveAccessToThisDatabase')}
          detail={knowledgeT('yourCredentialsCannotReadThisDatabaseContactThe')}
        />
      );
    }
    return (
      <CanvasError
        title={knowledgeT('unableToLoadDatabase')}
        detail={`${accessErrorCopy(locale)[code ?? ''] ?? knowledgeT('unableToReadDatabasePleaseRetry')}${code === 'NOT_FOUND' ? knowledgeT('databaseServiceEndpointUnavailable') : ''}`}
        onRetry={() => {
          void columnsQuery.refetch();
          void rowsQuery.refetch();
        }}
      />
    );
  }
  const loading = columnsQuery.isPending || rowsQuery.isPending;

  return (
    <section
      aria-label={knowledgeT('valueTableView', { v0: title ?? knowledgeT('database') })}
      className="flex h-full min-h-0 flex-col bg-[var(--panel)]"
    >
      {/* 视图头部 */}
      <header className="mx-auto w-full max-w-[1080px] shrink-0 px-6 pt-6">
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="flex size-7 items-center justify-center rounded-[7px] border border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]"
          >
            {icon ? (
              <span className="text-[15px] leading-none">{icon}</span>
            ) : (
              <Table aria-hidden className="size-4" weight="regular" />
            )}
          </span>
          <h1 className="min-w-0 truncate text-[17px] font-semibold tracking-[-0.01em] text-[var(--ink)]">
            {title ?? knowledgeT('database')}
          </h1>
          {!canEditCells ? (
            <span className="ml-1 rounded-[5px] border border-[var(--line)] px-1.5 py-px text-[10.5px] text-[var(--muted-strong)]">
              {knowledgeT('readOnly')}
            </span>
          ) : null}
        </div>
      </header>

      {/* 筛选排序栏 */}
      <div className="mx-auto w-full max-w-[1080px] shrink-0 px-6">
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-t-[8px]">
          <FilterSortBar
            columns={columns}
            filters={filters}
            sort={sort}
            members={members}
            focusColumnId={filterFocusColumnId}
            onFocusColumnConsumed={() => setFilterFocusColumnId(null)}
            onAddFilter={(filter) => setFilters((current) => [...current, filter])}
            onUpdateFilter={(index, filter) =>
              setFilters((current) =>
                current.map((candidate, position) => (position === index ? filter : candidate)),
              )
            }
            onRemoveFilter={(index) =>
              setFilters((current) => current.filter((_, position) => position !== index))
            }
            onAddSort={(key) =>
              setSort((current) =>
                current.some((candidate) => candidate.propertyId === key.propertyId)
                  ? current.map((candidate) =>
                      candidate.propertyId === key.propertyId ? key : candidate,
                    )
                  : [...current, key],
              )
            }
            onToggleSortDirection={(propertyId) =>
              setSort((current) => toggleSort(current, propertyId))
            }
            onRemoveSort={(propertyId) =>
              setSort((current) =>
                current.filter((candidate) => candidate.propertyId !== propertyId),
              )
            }
          />
          {canEditCells ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 rounded-[6px] px-2 text-[11.5px]"
              onClick={() => void createRow()}
              disabled={creatingRow}
            >
              <Plus aria-hidden className="size-3" />
              {knowledgeT('newRow2')}
            </Button>
          ) : null}
        </div>
      </div>

      {/* 操作失败横幅 */}
      {failureText ? (
        <div className="mx-auto w-full max-w-[1080px] shrink-0 px-6">
          <AppAlert tone="error" title={failureText} onClose={() => setFailureText(null)} />
        </div>
      ) : null}

      {/* 表格主体 */}
      <div className="mx-auto flex min-h-0 w-full max-w-[1080px] flex-1 flex-col px-6 pb-8">
        {loading ? (
          <TableSkeleton columns={Math.max(3, columns.length)} />
        ) : loadedCount === 0 ? (
          <CanvasState
            tone="accent"
            icon={<Table aria-hidden className="size-5" weight="regular" />}
            title={
              filters.length > 0
                ? knowledgeT('noRowsMatchTheFilters')
                : knowledgeT('noRowsInThisDatabaseYet')
            }
            hint={
              filters.length > 0
                ? knowledgeT('adjustOrRemoveFiltersToSeeMoreRows')
                : knowledgeT('eachRowIsAPageCreateARow')
            }
            announce="polite"
            actions={
              filters.length === 0 && canEditCells ? (
                <Button onClick={() => void createRow()} disabled={creatingRow}>
                  <Plus aria-hidden className="size-3.5" />
                  {knowledgeT('createFirstRow')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          <TableGrid
            columns={columns}
            rows={rows}
            filters={filters}
            sort={sort}
            members={members}
            canEditCells={canEditCells}
            canEditColumns={canEditColumns}
            pendingRowPageIds={pendingRowIds}
            personNameOf={personNameOf}
            onOpenRow={onOpenRow}
            onEditProperties={(pageId, properties) => void editProperties(pageId, properties)}
            onToggleSort={(columnId) => setSort((current) => toggleSort(current, columnId))}
            onFilterColumn={(column) => setFilterFocusColumnId(column.id)}
            onRenameColumn={(columnId, name) =>
              void replaceColumns(
                renameColumnPure(columns, columnId, name),
                knowledgeT('renameColumn'),
              )
            }
            onEditOptions={(column, anchor) => setOptionsEditor({ column, anchor })}
            onDeleteColumn={(columnId) =>
              void replaceColumns(removeColumnPure(columns, columnId), knowledgeT('deleteColumn'))
            }
            onAddColumn={(draft: ColumnDraft) =>
              void replaceColumns(appendColumn(columns, draft), knowledgeT('newColumn'))
            }
            onCreateRow={() => void createRow()}
            creatingRow={creatingRow}
          />
        )}

        {/* 分页 */}
        {!loading && loadedCount > 0 && rowsQuery.hasNextPage ? (
          <div className="mt-2 flex shrink-0 items-center justify-center">
            <button
              type="button"
              onClick={() => void rowsQuery.fetchNextPage()}
              disabled={rowsQuery.isFetchingNextPage}
              className="flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--line)] px-3 text-[11.5px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-[var(--surface-subtle)] disabled:pointer-events-none disabled:opacity-45"
            >
              {rowsQuery.isFetchingNextPage ? (
                <CircleNotch aria-hidden className="size-3 animate-spin" />
              ) : null}
              {knowledgeT('loadMoreLoaded')} {loadedCount}{' '}
              {knowledgeT(loadedCount === 1 ? 'oneRow' : 'rows')}
            </button>
          </div>
        ) : null}
      </div>

      {/* 选项编辑器（列菜单转发） */}
      {optionsEditor ? (
        <EditOptionsPanel
          column={optionsEditor.column}
          anchor={optionsEditor.anchor}
          onClose={() => setOptionsEditor(null)}
          onSaveOptions={(columnId, options) =>
            void replaceColumns(
              setColumnOptions(columns, columnId, options),
              knowledgeT('editOptions'),
            )
          }
        />
      ) : null}
    </section>
  );
}

function TableSkeleton({ columns }: { columns: number }) {
  return (
    <div className="py-1" aria-hidden>
      <div
        className="grid border-b border-[var(--line-strong)]"
        style={{
          gridTemplateColumns: `minmax(240px, 1.5fr) repeat(${Math.max(1, columns - 1)}, minmax(150px, 1fr))`,
        }}
      >
        <div className="h-[32px] animate-pulse bg-[var(--raise)]" />
        {Array.from({ length: Math.max(1, columns - 1) }, (_, index) => (
          <div
            key={index}
            className="h-[32px] animate-pulse border-l border-[var(--line)] bg-[var(--raise)]"
          />
        ))}
      </div>
      {Array.from({ length: 6 }, (_, rowIndex) => (
        <div
          key={rowIndex}
          className="grid border-b border-[var(--line)]"
          style={{
            gridTemplateColumns: `minmax(240px, 1.5fr) repeat(${Math.max(1, columns - 1)}, minmax(150px, 1fr))`,
          }}
        >
          <div
            className="h-[34px] animate-pulse"
            style={{
              animationDelay: `${rowIndex * 80}ms`,
              background: rowIndex % 3 === 0 ? 'var(--raise)' : 'transparent',
            }}
          />
          {Array.from({ length: Math.max(1, columns - 1) }, (_, columnIndex) => (
            <div
              key={columnIndex}
              className="h-[34px] animate-pulse border-l border-[var(--line)]"
              style={{
                animationDelay: `${rowIndex * 80 + columnIndex * 40}ms`,
                background: (rowIndex + columnIndex) % 3 === 0 ? 'var(--raise)' : 'transparent',
              }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

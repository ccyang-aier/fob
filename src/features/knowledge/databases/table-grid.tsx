'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './table-grid.messages';
/**
 * 数据库表格网格（U06）——行 × 列的网格语义与键盘契约。
 *
 * role=grid / row / gridcell（列头 columnheader），roving tabindex 只保留活动
 * 单元格。键位由 grid-navigation 状态机裁决：方向键移动、Tab 跨列环绕、Enter
 * 进入编辑（行名列打开行正文、复选列直接切换）、Space 切换复选、Escape 取消
 * 编辑、Home/End 行首行尾。单元格编辑是单元格内浮层，提交经 cell-model 契约
 * 镜像校验后整体回传（乐观回路在 table-operations）。行名列是页面按钮——
 * 行即页面，点击进入行正文。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Plus } from '@phosphor-icons/react';
import type {
  DatabaseRowSummary,
  Properties,
  PropertyDefinition,
  PropertyValue,
} from '@fob/shared/knowledge/contracts';
import { cn } from '@/lib/utils';
import { columnIsEditable } from './cell-model';
import {
  advanceGridCursor,
  gridActionFor,
  gridCursorAtEnd,
  gridCursorAtHome,
  moveGridCursorColumns,
  moveGridCursorRows,
  sameCursor,
  type GridCursor,
} from './grid-navigation';
import { anchorRectOf } from './anchored-panel';
import type { AnchorRect } from './anchored-panel';
import { CellContent, CellEditor } from './table-cells';
import type { PersonOption } from './table-cells';
import { AddColumnPanel, AddColumnTrigger, ColumnHeaderCell } from './table-header';
import type { ColumnDraft } from './table-header';
import type { SortKey } from './query-state';

export interface CellEditTarget {
  cursor: GridCursor;
  columnId: string;
  anchor: AnchorRect;
}

const ROW_HEIGHT = 34;

export function TableGrid({
  columns,
  rows,
  filters,
  sort,
  members,
  canEditCells,
  canEditColumns,
  pendingRowPageIds,
  personNameOf,
  onOpenRow,
  onEditProperties,
  onToggleSort,
  onFilterColumn,
  onRenameColumn,
  onEditOptions,
  onDeleteColumn,
  onAddColumn,
  onCreateRow,
  creatingRow,
}: {
  columns: readonly PropertyDefinition[];
  rows: readonly DatabaseRowSummary[];
  filters: readonly { propertyId: string }[];
  sort: readonly SortKey[];
  members: readonly PersonOption[];
  canEditCells: boolean;
  canEditColumns: boolean;
  pendingRowPageIds: ReadonlySet<string>;
  personNameOf: (userId: string) => string | null;
  onOpenRow: (pageId: string) => void;
  onEditProperties: (pageId: string, properties: Properties) => void;
  onToggleSort: (columnId: string) => void;
  onFilterColumn: (column: PropertyDefinition) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onEditOptions: (column: PropertyDefinition, anchor: AnchorRect) => void;
  onDeleteColumn: (columnId: string) => void;
  onAddColumn: (draft: ColumnDraft) => void;
  onCreateRow: () => void;
  creatingRow: boolean;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [cursor, setCursor] = useState<GridCursor>({ row: 0, column: 0 });
  const [editing, setEditing] = useState<CellEditTarget | null>(null);
  const [addColumnAnchor, setAddColumnAnchor] = useState<AnchorRect | null>(null);
  const cellRefs = useRef(new Map<string, HTMLDivElement>());
  const focusNextRef = useRef(false);

  const totalColumns = columns.length + 1;
  const size = { rows: rows.length, columns: totalColumns };

  const focusCursor = useCallback((next: GridCursor) => {
    focusNextRef.current = true;
    setCursor(next);
  }, []);

  useEffect(() => {
    if (!focusNextRef.current) return;
    focusNextRef.current = false;
    cellRefs.current.get(`${cursor.row}:${cursor.column}`)?.focus();
  }, [cursor]);

  // 行集合收缩后把光标夹回网格内（「渲染期间对齐状态」：一次性收敛，不级联）。
  const clamped: GridCursor = {
    row: Math.min(cursor.row, Math.max(0, rows.length - 1)),
    column: Math.min(cursor.column, Math.max(0, totalColumns - 1)),
  };
  if (!sameCursor(clamped, cursor)) setCursor(clamped);

  const columnAt = (index: number): PropertyDefinition | null =>
    index <= 0 ? null : (columns[index - 1] ?? null);

  const rowAt = (index: number): DatabaseRowSummary | null => rows[index] ?? null;

  const beginEdit = (target: GridCursor, element: HTMLDivElement | null) => {
    const column = columnAt(target.column);
    const row = rowAt(target.row);
    if (!column || !row || !canEditCells || !columnIsEditable(column.type)) return false;
    setEditing({ cursor: target, columnId: column.id, anchor: anchorRectOf(element) });
    return true;
  };

  /** 复选单元格：Enter / Space / 单击都直接切换（无浮层编辑态）。 */
  const toggleCheckbox = (row: DatabaseRowSummary, column: PropertyDefinition) => {
    if (!canEditCells) return;
    const current = row.properties[column.id];
    onEditProperties(row.pageId, { ...row.properties, [column.id]: current !== true });
  };

  const handleGridKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;
    const action = gridActionFor(event.key, {
      ctrlOrMeta: event.ctrlKey || event.metaKey,
      alt: event.altKey,
    });
    if (!action) return;
    event.preventDefault();
    switch (action.type) {
      case 'move-column':
        focusCursor(moveGridCursorColumns(cursor, size, action.delta));
        break;
      case 'move-row':
        focusCursor(moveGridCursorRows(cursor, size, action.delta));
        break;
      case 'tab':
        focusCursor(advanceGridCursor(cursor, size, action.forward));
        break;
      case 'first-column':
        focusCursor(gridCursorAtHome(cursor));
        break;
      case 'last-column':
        focusCursor(gridCursorAtEnd(cursor, size));
        break;
      case 'edit': {
        const row = rowAt(cursor.row);
        if (!row) break;
        if (cursor.column === 0) {
          onOpenRow(row.pageId);
          break;
        }
        const column = columnAt(cursor.column);
        if (!column) break;
        if (column.type === 'checkbox') toggleCheckbox(row, column);
        else beginEdit(cursor, cellRefs.current.get(`${cursor.row}:${cursor.column}`) ?? null);
        break;
      }
      case 'toggle': {
        const row = rowAt(cursor.row);
        const column = columnAt(cursor.column);
        if (row && column && column.type === 'checkbox') toggleCheckbox(row, column);
        break;
      }
      case 'cancel':
        setEditing(null);
        break;
    }
  };

  const commitEdit = (row: DatabaseRowSummary, column: PropertyDefinition, next: PropertyValue) => {
    setEditing(null);
    onEditProperties(row.pageId, { ...row.properties, [column.id]: next });
    focusCursor(editing?.cursor ?? cursor);
  };

  const gridTemplate = `minmax(240px, 1.5fr) repeat(${columns.length}, minmax(150px, 1fr))`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          role="grid"
          aria-label={knowledgeT('databaseTable')}
          aria-rowcount={rows.length}
          onKeyDown={handleGridKeyDown}
          className="min-w-full"
        >
          {/* 列头 */}
          <div
            role="row"
            aria-rowindex={1}
            className="sticky top-0 z-10 grid border-b border-[var(--line-strong)] bg-[var(--surface-subtle)]"
            style={{ gridTemplateColumns: gridTemplate }}
          >
            <div
              role="columnheader"
              aria-colindex={1}
              className="flex h-[32px] items-center gap-1.5 px-2 text-[11.5px] font-medium text-[var(--muted-strong)]"
            >
              <FileText aria-hidden className="size-3.5 text-[var(--muted)]" />
              {knowledgeT('page')}
            </div>
            {columns.map((column, index) => (
              <div
                role="columnheader"
                aria-colindex={index + 2}
                key={column.id}
                className="h-[32px] border-l border-[var(--line)]"
              >
                <ColumnHeaderCell
                  column={column}
                  sortKey={sort.find((key) => key.propertyId === column.id)}
                  hasFilter={filters.some((filter) => filter.propertyId === column.id)}
                  canEditColumns={canEditColumns}
                  onToggleSort={onToggleSort}
                  onFilterColumn={onFilterColumn}
                  onRenameColumn={onRenameColumn}
                  onEditOptions={onEditOptions}
                  onDeleteColumn={onDeleteColumn}
                />
              </div>
            ))}
            {canEditColumns ? (
              <div className="sticky right-0 flex h-[32px] items-center border-l border-[var(--line)] bg-[var(--surface-subtle)]">
                <AddColumnTrigger onOpen={setAddColumnAnchor} />
              </div>
            ) : null}
          </div>

          {/* 行 */}
          {rows.map((row, rowIndex) => {
            const pending = pendingRowPageIds.has(row.pageId);
            return (
              <div
                key={row.pageId}
                role="row"
                aria-rowindex={rowIndex + 2}
                className="group grid border-b border-[var(--line)] transition-opacity"
                style={{
                  gridTemplateColumns: gridTemplate,
                  height: ROW_HEIGHT,
                  opacity: pending ? 0.55 : 1,
                }}
              >
                <div
                  role="rowheader"
                  aria-colindex={1}
                  ref={(element) => {
                    registerCell(cellRefs, rowIndex, 0, element);
                  }}
                  tabIndex={cursor.row === rowIndex && cursor.column === 0 ? 0 : -1}
                  onFocus={() => setCursor({ row: rowIndex, column: 0 })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      event.stopPropagation();
                      onOpenRow(row.pageId);
                    }
                  }}
                  className={cn(
                    'relative flex min-w-0 items-center outline-none',
                    cursor.row === rowIndex &&
                      cursor.column === 0 &&
                      'z-[1] shadow-[inset_0_0_0_1.5px_var(--focus-ring)]',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onOpenRow(row.pageId)}
                    className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none"
                  >
                    <FileText aria-hidden className="size-3.5 shrink-0 text-[var(--muted)]" />
                    <span className="truncate text-[12.5px] text-[var(--ink)]">
                      {row.title === '' ? knowledgeT('untitled') : row.title}
                    </span>
                  </button>
                </div>
                {columns.map((column, columnIndex) => {
                  const gridColumn = columnIndex + 1;
                  const value = row.properties[column.id];
                  const isEditing =
                    editing !== null &&
                    editing.cursor.row === rowIndex &&
                    editing.cursor.column === gridColumn &&
                    editing.columnId === column.id;
                  return (
                    <div
                      key={column.id}
                      role="gridcell"
                      aria-colindex={gridColumn + 1}
                      aria-readonly={
                        canEditCells && columnIsEditable(column.type) ? undefined : true
                      }
                      ref={(element) => {
                        registerCell(cellRefs, rowIndex, gridColumn, element);
                      }}
                      tabIndex={cursor.row === rowIndex && cursor.column === gridColumn ? 0 : -1}
                      onFocus={() => setCursor({ row: rowIndex, column: gridColumn })}
                      onClick={() => {
                        if (column.type === 'checkbox') toggleCheckbox(row, column);
                        else if (canEditCells && columnIsEditable(column.type))
                          beginEdit(
                            { row: rowIndex, column: gridColumn },
                            cellRefs.current.get(`${rowIndex}:${gridColumn}`) ?? null,
                          );
                      }}
                      className={cn(
                        'relative flex min-w-0 items-center px-2 text-[12.5px] text-[var(--ink-soft)] outline-none',
                        column.type === 'number' && 'justify-end text-right',
                        cursor.row === rowIndex &&
                          cursor.column === gridColumn &&
                          'z-[1] shadow-[inset_0_0_0_1.5px_var(--focus-ring)]',
                        !isEditing && 'cursor-default',
                      )}
                    >
                      {isEditing ? (
                        <CellEditor
                          column={column}
                          value={value}
                          anchor={editing.anchor}
                          members={members}
                          onCommit={(next) => commitEdit(row, column, next)}
                          onCancel={() => {
                            setEditing(null);
                            focusCursor(editing.cursor);
                          }}
                        />
                      ) : (
                        <CellContent column={column} value={value} personNameOf={personNameOf} />
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}

          {/* 新行 */}
          {canEditCells ? (
            <div role="row" className="grid" style={{ gridTemplateColumns: gridTemplate }}>
              <div role="gridcell" aria-colindex={1} className="flex items-center">
                <button
                  type="button"
                  disabled={creatingRow}
                  onClick={onCreateRow}
                  className="flex h-[34px] w-full items-center gap-1.5 px-2 text-[12px] text-[var(--muted)] outline-none transition-colors hover:bg-wash hover:text-[var(--ink-soft)] disabled:pointer-events-none disabled:opacity-45"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {creatingRow ? knowledgeT('creating') : knowledgeT('newRow')}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {addColumnAnchor ? (
        <AddColumnPanel
          anchor={addColumnAnchor}
          onClose={() => setAddColumnAnchor(null)}
          onCreate={(draft) => {
            onAddColumn(draft);
            setAddColumnAnchor(null);
          }}
        />
      ) : null}
    </div>
  );
}

function registerCell(
  refs: React.MutableRefObject<Map<string, HTMLDivElement>>,
  row: number,
  column: number,
  element: HTMLDivElement | null,
) {
  const key = `${row}:${column}`;
  if (element) refs.current.set(key, element);
  else refs.current.delete(key);
}

'use client';

import { createTranslator, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './filter-sort-bar.messages';

/**
 * 筛选 / 排序工具栏（U06）——契约 `queryDatabaseInputSchema` 的 UI 投影。
 *
 * 触发按钮打开锚定面板：先选列（按列类型给出合法操作符），再按操作符形态
 * 编辑值；确认前经 buildFilter 的共享契约镜像校验，非法组合禁用确认按钮。
 * 已有条件以芯片呈现：点击重开编辑、× 移除；排序芯片点击切换方向。
 * 状态变化即换查询键由服务端重取，客户端不做第二套过滤语义。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Funnel } from '@phosphor-icons/react';
import type {
  DatabaseFilter,
  PropertyDefinition,
  PropertyValue,
} from '@fob/shared/knowledge/contracts';
import { cn } from '@/lib/utils';
import {
  buildFilter,
  defaultOperatorForType,
  filterNeedsValue,
  filterValueEditor,
  operatorText,
  operatorsForType,
  type FilterOperator,
  type SortKey,
} from './query-state';
import type { PersonOption } from './table-cells';
import { AnchoredPanel, anchorRectOf } from './anchored-panel';
import type { AnchorRect } from './anchored-panel';

const knowledgeT = createTranslator(knowledgeMessages);

const triggerClasses =
  'flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--line)] px-2 text-[11.5px] text-[var(--muted-strong)] outline-none transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-subtle)]';

export function FilterSortBar({
  columns,
  filters,
  sort,
  members,
  focusColumnId,
  onFocusColumnConsumed,
  onAddFilter,
  onUpdateFilter,
  onRemoveFilter,
  onAddSort,
  onToggleSortDirection,
  onRemoveSort,
}: {
  columns: readonly PropertyDefinition[];
  filters: readonly DatabaseFilter[];
  sort: readonly SortKey[];
  members: readonly PersonOption[];
  /** 列菜单「筛选此列」转发的意图：直接打开预选该列的筛选面板。 */
  focusColumnId?: string | null;
  onFocusColumnConsumed?: () => void;
  onAddFilter: (filter: DatabaseFilter) => void;
  onUpdateFilter: (index: number, filter: DatabaseFilter) => void;
  onRemoveFilter: (index: number) => void;
  onAddSort: (key: SortKey) => void;
  onToggleSortDirection: (propertyId: string) => void;
  onRemoveSort: (propertyId: string) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const columnOf = (propertyId: string) => columns.find((column) => column.id === propertyId);
  const [filterPanel, setFilterPanel] = useState<{
    anchor: AnchorRect;
    editIndex: number | null;
    initialColumnId?: string;
  } | null>(null);
  const [sortPanel, setSortPanel] = useState<AnchorRect | null>(null);
  const hasColumns = columns.length > 0;
  const filterTriggerRef = useRef<HTMLButtonElement>(null);

  // 「筛选此列」意图到达时，以筛选触发器为锚打开预选面板。
  useEffect(() => {
    if (!focusColumnId) return;
    const column = columns.find((candidate) => candidate.id === focusColumnId);
    if (!column) {
      onFocusColumnConsumed?.();
      return;
    }
    setFilterPanel({
      anchor: anchorRectOf(filterTriggerRef.current),
      editIndex: null,
      initialColumnId: column.id,
    });
    onFocusColumnConsumed?.();
  }, [focusColumnId, columns, onFocusColumnConsumed]);

  return (
    <div className="flex min-h-[36px] flex-wrap items-center gap-1.5 px-3 py-1.5">
      <button
        ref={filterTriggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={filterPanel !== null}
        disabled={!hasColumns}
        onClick={(event) =>
          setFilterPanel({ anchor: anchorRectOf(event.currentTarget), editIndex: null })
        }
        className={triggerClasses}
        title={hasColumns ? undefined : knowledgeT('noPropertyColumnsInThisDatabaseYet')}
      >
        <Funnel aria-hidden className="size-3" />
        {knowledgeT('filter')}
      </button>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={sortPanel !== null}
        disabled={!hasColumns}
        onClick={(event) => setSortPanel(anchorRectOf(event.currentTarget))}
        className={triggerClasses}
        title={hasColumns ? undefined : knowledgeT('noPropertyColumnsInThisDatabaseYet')}
      >
        <ArrowUp aria-hidden className="size-3" />
        {knowledgeT('sort')}
      </button>

      {filters.map((filter, index) => {
        const column = columnOf(filter.propertyId);
        if (!column) return null;
        return (
          <span
            key={`${filter.propertyId}-${filter.operator}-${index}`}
            className="group flex h-7 items-center gap-1 rounded-[6px] bg-[var(--raise)] pl-2 pr-1 text-[11.5px] text-[var(--ink-soft)]"
          >
            <button
              type="button"
              aria-label={knowledgeT('editFilterValueValue', {
                v0: column.name,
                v1: operatorText(locale)[filter.operator],
              })}
              onClick={(event) =>
                setFilterPanel({ anchor: anchorRectOf(event.currentTarget), editIndex: index })
              }
              className="flex min-w-0 items-center gap-1 rounded-[5px] px-0.5 outline-none"
            >
              <span className="max-w-32 truncate font-medium">{column.name}</span>
              <span className="text-[var(--muted-strong)]">
                {operatorText(locale)[filter.operator]}
              </span>
              {filterNeedsValue(filter.operator) ? (
                <span className="max-w-40 truncate">
                  {filterValueText(column, filter.value, members)}
                </span>
              ) : null}
            </button>
            <button
              type="button"
              aria-label={knowledgeT('removeFilterValue', { v0: column.name })}
              onClick={() => onRemoveFilter(index)}
              className="flex size-5 items-center justify-center rounded-[4px] text-[13px] leading-none text-[var(--muted)] outline-none transition-colors hover:bg-wash hover:text-[var(--err-ink)]"
            >
              ×
            </button>
          </span>
        );
      })}

      {sort.map((key) => {
        const column = columnOf(key.propertyId);
        if (!column) return null;
        return (
          <span
            key={key.propertyId}
            className="flex h-7 items-center gap-1 rounded-[6px] bg-[var(--raise)] pl-2 pr-1 text-[11.5px] text-[var(--ink-soft)]"
          >
            <button
              type="button"
              aria-label={knowledgeT('changeSortDirectionValueCurrentlyValue', {
                v0: column.name,
                v1: key.direction === 'asc' ? knowledgeT('ascending') : knowledgeT('descending'),
              })}
              onClick={() => onToggleSortDirection(key.propertyId)}
              className="flex min-w-0 items-center gap-1 rounded-[5px] px-0.5 outline-none"
            >
              <span className="max-w-32 truncate font-medium">{column.name}</span>
              {key.direction === 'asc' ? (
                <ArrowUp aria-hidden className="size-3 text-[var(--muted-strong)]" />
              ) : (
                <ArrowDown aria-hidden className="size-3 text-[var(--muted-strong)]" />
              )}
            </button>
            <button
              type="button"
              aria-label={knowledgeT('removeSortValue', { v0: column.name })}
              onClick={() => onRemoveSort(key.propertyId)}
              className="flex size-5 items-center justify-center rounded-[4px] text-[13px] leading-none text-[var(--muted)] outline-none transition-colors hover:bg-wash hover:text-[var(--err-ink)]"
            >
              ×
            </button>
          </span>
        );
      })}

      {filterPanel ? (
        <FilterPanel
          anchor={filterPanel.anchor}
          columns={columns}
          members={members}
          initial={filterPanel.editIndex === null ? null : filters[filterPanel.editIndex]!}
          initialColumnId={filterPanel.initialColumnId}
          onClose={() => setFilterPanel(null)}
          onConfirm={(filter) => {
            if (filterPanel.editIndex === null) onAddFilter(filter);
            else onUpdateFilter(filterPanel.editIndex, filter);
            setFilterPanel(null);
          }}
        />
      ) : null}

      {sortPanel ? (
        <SortPanel
          anchor={sortPanel}
          columns={columns}
          sort={sort}
          onClose={() => setSortPanel(null)}
          onPick={(key) => {
            onAddSort(key);
            setSortPanel(null);
          }}
        />
      ) : null}
    </div>
  );
}

function filterValueText(
  column: PropertyDefinition,
  value: PropertyValue | undefined,
  members: readonly PersonOption[],
): string {
  if (value === undefined || value === null) return '';
  if (column.type === 'select')
    return column.options?.find((option) => option.id === value)?.label ?? String(value);
  if (column.type === 'multiSelect')
    return column.options?.find((option) => option.id === value)?.label ?? String(value);
  if (column.type === 'person') {
    const member = members.find((candidate) => candidate.userId === value);
    return member?.name ?? String(value).slice(0, 8);
  }
  if (column.type === 'checkbox') return value === true ? knowledgeT('yes') : knowledgeT('no');
  return String(value);
}

const panelSelect =
  'h-[28px] w-full rounded-[5px] border border-[var(--line-strong)] bg-[var(--panel)] px-1.5 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--accent)]';
const panelInput =
  'h-[28px] w-full rounded-[5px] border border-[var(--line-strong)] bg-[var(--panel)] px-2 text-[12px] text-[var(--ink)] outline-none focus:border-[var(--accent)]';

function FilterPanel({
  anchor,
  columns,
  members,
  initial,
  initialColumnId,
  onClose,
  onConfirm,
}: {
  anchor: AnchorRect;
  columns: readonly PropertyDefinition[];
  members: readonly PersonOption[];
  initial: DatabaseFilter | null;
  initialColumnId?: string;
  onClose: () => void;
  onConfirm: (filter: DatabaseFilter) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [propertyId, setPropertyId] = useState(
    initial?.propertyId ?? initialColumnId ?? columns[0]?.id ?? '',
  );
  const column = useMemo(
    () => columns.find((candidate) => candidate.id === propertyId),
    [columns, propertyId],
  );
  const [operator, setOperator] = useState<FilterOperator>(
    initial?.operator ?? (column ? defaultOperatorForType(column.type) : 'isEmpty'),
  );
  const [valueDraft, setValueDraft] = useState<string | boolean>(
    initial?.value === undefined
      ? ''
      : typeof initial.value === 'boolean'
        ? initial.value
        : String(initial.value),
  );

  const operators = column ? operatorsForType(column.type) : [];
  const editor = column ? filterValueEditor(column, operator) : 'none';
  const built = column
    ? buildFilter(
        column,
        operator,
        editor === 'boolean'
          ? valueDraft
          : valueDraft === ''
            ? undefined
            : editor === 'number'
              ? valueDraft
              : valueDraft,
      )
    : null;
  const confirmDisabled = !built?.ok;

  return (
    <AnchoredPanel
      anchor={anchor}
      onClose={onClose}
      label={knowledgeT('filterConditions')}
      width={264}
    >
      <div className="space-y-1.5 p-1.5">
        <select
          aria-label={knowledgeT('filterColumn')}
          value={propertyId}
          onChange={(event) => {
            setPropertyId(event.target.value);
            const next = columns.find((candidate) => candidate.id === event.target.value);
            setOperator(next ? defaultOperatorForType(next.type) : 'isEmpty');
            setValueDraft('');
          }}
          className={panelSelect}
        >
          {columns.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
        <select
          aria-label={knowledgeT('operator')}
          value={operator}
          onChange={(event) => {
            setOperator(event.target.value as FilterOperator);
            setValueDraft('');
          }}
          className={panelSelect}
        >
          {operators.map((candidate) => (
            <option key={candidate} value={candidate}>
              {operatorText(locale)[candidate]}
            </option>
          ))}
        </select>
        {column && editor !== 'none' ? (
          <FilterValueInput
            column={column}
            editor={editor}
            members={members}
            draft={valueDraft}
            onChange={setValueDraft}
            onEnter={() => {
              if (built?.ok) onConfirm(built.filter);
            }}
          />
        ) : null}
        <div className="flex justify-end border-t border-[var(--line)] pt-2">
          <button
            type="button"
            disabled={confirmDisabled}
            onClick={() => {
              if (built?.ok) onConfirm(built.filter);
            }}
            className="flex h-7 items-center rounded-[5px] bg-[var(--accent)] px-2.5 text-[11.5px] font-medium text-[var(--accent-foreground)] outline-none transition-colors hover:bg-[var(--accent-strong)] disabled:pointer-events-none disabled:opacity-45"
          >
            {initial ? knowledgeT('updateFilter') : knowledgeT('addFilter')}
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}

function FilterValueInput({
  column,
  editor,
  members,
  draft,
  onChange,
  onEnter,
}: {
  column: PropertyDefinition;
  editor: ReturnType<typeof filterValueEditor>;
  members: readonly PersonOption[];
  draft: string | boolean;
  onChange: (draft: string | boolean) => void;
  onEnter: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const onKeyDown = (event: React.KeyboardEvent) => {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      onEnter();
    } else if (event.key === 'Escape') {
      event.preventDefault();
    }
  };
  if (editor === 'boolean') {
    return (
      <div role="radiogroup" aria-label={knowledgeT('comparisonValue')} className="flex gap-1">
        {[true, false].map((candidate) => (
          <button
            key={String(candidate)}
            type="button"
            role="radio"
            aria-checked={draft === candidate}
            onClick={() => onChange(candidate)}
            className={cn(
              'h-[28px] flex-1 rounded-[5px] border text-[11.5px] outline-none transition-colors',
              draft === candidate
                ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-wash',
            )}
          >
            {candidate ? knowledgeT('yes') : knowledgeT('no')}
          </button>
        ))}
      </div>
    );
  }
  if (editor === 'option') {
    const options = column.options ?? [];
    return (
      <select
        aria-label={knowledgeT('comparisonValue')}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(event) => onChange(event.target.value)}
        className={panelSelect}
      >
        <option value="">{knowledgeT('chooseAnOption')}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  if (editor === 'person') {
    return (
      <select
        aria-label={knowledgeT('comparisonValue')}
        value={typeof draft === 'string' ? draft : ''}
        onChange={(event) => onChange(event.target.value)}
        className={panelSelect}
      >
        <option value="">{knowledgeT('chooseAMember')}</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
          </option>
        ))}
      </select>
    );
  }
  const placeholder =
    editor === 'date'
      ? 'YYYY-MM-DD'
      : editor === 'number'
        ? knowledgeT('number')
        : editor === 'text' && column.type === 'url'
          ? 'https://…'
          : knowledgeT('text');
  return (
    <input
      autoFocus
      type="text"
      inputMode={editor === 'number' ? 'decimal' : undefined}
      value={typeof draft === 'string' ? draft : ''}
      placeholder={placeholder}
      aria-label={knowledgeT('comparisonValue')}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={onKeyDown}
      className={panelInput}
    />
  );
}

function SortPanel({
  anchor,
  columns,
  sort,
  onClose,
  onPick,
}: {
  anchor: AnchorRect;
  columns: readonly PropertyDefinition[];
  sort: readonly SortKey[];
  onClose: () => void;
  onPick: (key: SortKey) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [propertyId, setPropertyId] = useState(columns[0]?.id ?? '');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');
  const existing = sort.find((key) => key.propertyId === propertyId);

  return (
    <AnchoredPanel anchor={anchor} onClose={onClose} label={knowledgeT('sort')} width={240}>
      <div className="space-y-1.5 p-1.5">
        <select
          aria-label={knowledgeT('sortColumn')}
          value={propertyId}
          onChange={(event) => setPropertyId(event.target.value)}
          className={panelSelect}
        >
          {columns.map((column) => (
            <option key={column.id} value={column.id}>
              {column.name}
            </option>
          ))}
        </select>
        <div role="radiogroup" aria-label={knowledgeT('sortDirection')} className="flex gap-1">
          {(['asc', 'desc'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="radio"
              aria-checked={direction === candidate}
              onClick={() => setDirection(candidate)}
              className={cn(
                'h-[28px] flex-1 rounded-[5px] border text-[11.5px] outline-none transition-colors',
                direction === candidate
                  ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                  : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-wash',
              )}
            >
              {candidate === 'asc' ? knowledgeT('ascending') : knowledgeT('descending')}
            </button>
          ))}
        </div>
        <div className="flex justify-end border-t border-[var(--line)] pt-2">
          <button
            type="button"
            disabled={propertyId === ''}
            onClick={() => onPick({ propertyId, direction })}
            className="flex h-7 items-center rounded-[5px] bg-[var(--accent)] px-2.5 text-[11.5px] font-medium text-[var(--accent-foreground)] outline-none transition-colors hover:bg-[var(--accent-strong)] disabled:pointer-events-none disabled:opacity-45"
          >
            {existing ? knowledgeT('updateSort') : knowledgeT('addSort')}
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}

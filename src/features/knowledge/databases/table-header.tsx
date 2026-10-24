'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './table-header.messages';
/**
 * 表头与列管理（U06）——列头菜单（排序 / 筛选 / 重命名 / 选项 / 删除）与
 * 加列面板。列编辑走 T02 的整体替换语义：类型创建后不可改（菜单里如实禁用），
 * 改名与选项调整即时生效，删列经两步确认（服务端会在同一事务剥离全部行键）。
 * 结构变更需要页面 full 级权限，无权限时入口只读展示。
 */

import { useState } from 'react';
import { ArrowDown, ArrowUp, Funnel, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import type { PropertyDefinition } from '@fob/shared/knowledge/contracts';
import { cn } from '@/lib/utils';
import { newOptionId, optionColorClass } from './cell-model';
import { propertyTypeIcon as iconOf, propertyTypeLabel as labelOf } from './table-cells';
import { AnchoredPanel, anchorRectOf } from './anchored-panel';
import type { AnchorRect } from './anchored-panel';
import type { SortKey } from './query-state';

const palette = ['blue', 'green', 'amber', 'rose', 'violet', 'cyan'] as const;

export interface ColumnOptionDraft {
  id: string;
  label: string;
  color: string;
}

export interface ColumnDraft {
  name: string;
  type: PropertyDefinition['type'];
  options: ColumnOptionDraft[];
}

export function newColumnDraft(type: PropertyDefinition['type'] = 'text'): ColumnDraft {
  return { name: '', type, options: [] };
}

const menuButton =
  'fob-menu-item flex h-[30px] w-full items-center gap-2.5 rounded-[5px] px-2.5 text-left outline-none transition-colors disabled:pointer-events-none disabled:opacity-45';

// ── 列头 ──

export function ColumnHeaderCell({
  column,
  sortKey,
  hasFilter,
  canEditColumns,
  onToggleSort,
  onFilterColumn,
  onRenameColumn,
  onEditOptions,
  onDeleteColumn,
}: {
  column: PropertyDefinition;
  sortKey: SortKey | undefined;
  hasFilter: boolean;
  canEditColumns: boolean;
  onToggleSort: (columnId: string) => void;
  onFilterColumn: (column: PropertyDefinition) => void;
  onRenameColumn: (columnId: string, name: string) => void;
  onEditOptions: (column: PropertyDefinition, anchor: AnchorRect) => void;
  onDeleteColumn: (columnId: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [anchor, setAnchor] = useState<AnchorRect | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [name, setName] = useState(column.name);

  const close = () => {
    setAnchor(null);
    setRenaming(false);
    setConfirmingDelete(false);
    setName(column.name);
  };

  return (
    <div className="relative flex h-full items-center">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(anchorRectOf(event.currentTarget))}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 px-2 text-left outline-none"
      >
        <span aria-hidden className="shrink-0 text-[var(--muted)]">
          {iconOf(column.type)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-[var(--muted-strong)]">
          {column.name}
        </span>
        {hasFilter ? (
          <span aria-hidden className="shrink-0 text-[10px] text-[var(--accent-ink)]">
            ◕
          </span>
        ) : null}
        {sortKey ? (
          <span
            aria-hidden
            className={cn(
              'shrink-0 text-[10px] leading-none text-[var(--muted)] transition-transform',
              sortKey.direction === 'desc' && 'rotate-180',
            )}
          >
            ▲
          </span>
        ) : null}
      </button>

      {anchor ? (
        <AnchoredPanel
          anchor={anchor}
          onClose={close}
          label={knowledgeT('valueColumnMenu', { v0: column.name })}
          width={224}
        >
          <div role="menu" aria-label={knowledgeT('valueColumnMenu', { v0: column.name })}>
            {renaming ? (
              <div className="p-1">
                <input
                  autoFocus
                  type="text"
                  value={name}
                  aria-label={knowledgeT('columnName')}
                  maxLength={80}
                  onChange={(event) => setName(event.target.value)}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      if (name.trim() !== '') onRenameColumn(column.id, name.trim());
                      close();
                    } else if (event.key === 'Escape') {
                      event.preventDefault();
                      close();
                    }
                  }}
                  className="h-[28px] w-full rounded-[5px] border border-[var(--accent)] bg-[var(--panel)] px-2 text-[12px] outline-none"
                />
              </div>
            ) : confirmingDelete ? (
              <div className="p-1.5">
                <p className="px-1 pb-2 text-[11.5px] leading-relaxed text-[var(--ink-soft)]">
                  {knowledgeT('delete')}
                  {column.name}
                  {knowledgeT('andRemoveItsValueFromEveryRow')}
                </p>
                <div className="flex justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={close}
                    className={cn(menuButton, 'h-7 w-auto justify-center px-2.5 font-normal')}
                  >
                    {knowledgeT('cancel')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onDeleteColumn(column.id);
                      close();
                    }}
                    className="flex h-7 items-center rounded-[5px] bg-[var(--err-ink)] px-2.5 text-[11.5px] font-medium text-white outline-none transition-opacity hover:opacity-90"
                  >
                    {knowledgeT('deleteColumn')}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className={menuButton}
                  onClick={() => {
                    onToggleSort(column.id);
                    close();
                  }}
                >
                  <span
                    aria-hidden
                    className="flex size-3.5 items-center justify-center text-[var(--muted)]"
                  >
                    <ArrowUp className="size-3.5" />
                  </span>
                  {sortKey?.direction === 'asc'
                    ? knowledgeT('removeAscendingSort')
                    : knowledgeT('sortThisColumnAscending')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuButton}
                  onClick={() => {
                    onToggleSort(column.id);
                    close();
                  }}
                >
                  <span
                    aria-hidden
                    className="flex size-3.5 items-center justify-center text-[var(--muted)]"
                  >
                    <ArrowDown className="size-3.5" />
                  </span>
                  {sortKey?.direction === 'desc'
                    ? knowledgeT('removeDescendingSort')
                    : knowledgeT('sortThisColumnDescending')}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className={menuButton}
                  onClick={() => {
                    onFilterColumn(column);
                    close();
                  }}
                >
                  <span
                    aria-hidden
                    className="flex size-3.5 items-center justify-center text-[var(--muted)]"
                  >
                    <Funnel className="size-3.5" />
                  </span>
                  {knowledgeT('filterThisColumn')}
                </button>
                <div className="my-1 border-t border-[var(--line)]" />
                <button
                  type="button"
                  role="menuitem"
                  className={menuButton}
                  disabled={!canEditColumns}
                  onClick={() => setRenaming(true)}
                  title={
                    canEditColumns ? undefined : knowledgeT('pageFullControlPermissionRequired')
                  }
                >
                  <span
                    aria-hidden
                    className="flex size-3.5 items-center justify-center text-[var(--muted)]"
                  >
                    <PencilSimple className="size-3.5" />
                  </span>
                  {knowledgeT('rename')}
                </button>
                {column.type === 'select' || column.type === 'multiSelect' ? (
                  <button
                    type="button"
                    role="menuitem"
                    className={menuButton}
                    disabled={!canEditColumns}
                    onClick={() => {
                      onEditOptions(column, anchor);
                      close();
                    }}
                    title={
                      canEditColumns ? undefined : knowledgeT('pageFullControlPermissionRequired')
                    }
                  >
                    <span
                      aria-hidden
                      className="flex size-3.5 items-center justify-center text-[var(--muted)]"
                    >
                      {iconOf(column.type)}
                    </span>
                    {knowledgeT('editOptions')}
                  </button>
                ) : null}
                <button
                  type="button"
                  role="menuitem"
                  className={menuButton}
                  data-variant="destructive"
                  disabled={!canEditColumns}
                  title={
                    canEditColumns ? undefined : knowledgeT('pageFullControlPermissionRequired')
                  }
                  onClick={() => setConfirmingDelete(true)}
                >
                  <span aria-hidden className="flex size-3.5 items-center justify-center">
                    <Trash className="size-3.5" />
                  </span>
                  {knowledgeT('deleteColumn')}
                </button>
              </>
            )}
          </div>
        </AnchoredPanel>
      ) : null}
    </div>
  );
}

// ── 加列 / 编辑选项面板 ──

const creatableTypes: PropertyDefinition['type'][] = [
  'text',
  'number',
  'date',
  'checkbox',
  'select',
  'multiSelect',
  'person',
  'url',
];
const selectableTypes: PropertyDefinition['type'][] = ['select', 'multiSelect'];

export function AddColumnPanel({
  anchor,
  onClose,
  onCreate,
}: {
  anchor: AnchorRect;
  onClose: () => void;
  onCreate: (draft: ColumnDraft) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [draft, setDraft] = useState<ColumnDraft>(newColumnDraft());
  const needsOptions = selectableTypes.includes(draft.type);

  const submit = () => {
    if (draft.name.trim() === '') return;
    if (needsOptions && draft.options.length === 0) return;
    onCreate({ ...draft, name: draft.name.trim() });
    onClose();
  };

  return (
    <AnchoredPanel anchor={anchor} onClose={onClose} label={knowledgeT('newColumn')} width={264}>
      <div className="space-y-2 p-1.5">
        <input
          autoFocus
          type="text"
          value={draft.name}
          placeholder={knowledgeT('columnName')}
          aria-label={knowledgeT('columnName')}
          maxLength={80}
          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            } else if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
          className="h-[28px] w-full rounded-[5px] border border-[var(--line-strong)] bg-[var(--panel)] px-2 text-[12px] outline-none focus:border-[var(--accent)]"
        />
        <div
          role="radiogroup"
          aria-label={knowledgeT('columnType')}
          className="grid grid-cols-2 gap-1"
        >
          {creatableTypes.map((type) => (
            <button
              key={type}
              type="button"
              role="radio"
              aria-checked={draft.type === type}
              onClick={() => setDraft((current) => ({ ...current, type }))}
              className={cn(
                'flex h-[30px] items-center gap-1.5 rounded-[5px] border px-2 text-[11.5px] outline-none transition-colors',
                draft.type === type
                  ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]'
                  : 'border-[var(--line)] text-[var(--ink-soft)] hover:bg-wash',
              )}
            >
              <span aria-hidden className="text-[var(--muted)]">
                {iconOf(type)}
              </span>
              {labelOf(locale)[type]}
            </button>
          ))}
        </div>
        {needsOptions ? <OptionsEditor draft={draft} onChange={setDraft} /> : null}
        <div className="flex justify-end border-t border-[var(--line)] pt-2">
          <button
            type="button"
            onClick={submit}
            disabled={draft.name.trim() === '' || (needsOptions && draft.options.length === 0)}
            className="flex h-7 items-center rounded-[5px] bg-[var(--accent)] px-2.5 text-[11.5px] font-medium text-[var(--accent-foreground)] outline-none transition-colors hover:bg-[var(--accent-strong)] disabled:pointer-events-none disabled:opacity-45"
          >
            {knowledgeT('createColumn')}
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}

export function EditOptionsPanel({
  column,
  anchor,
  onClose,
  onSaveOptions,
}: {
  column: PropertyDefinition;
  anchor: AnchorRect;
  onClose: () => void;
  onSaveOptions: (columnId: string, options: ColumnOptionDraft[]) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [options, setOptions] = useState<ColumnOptionDraft[]>(
    (column.options ?? []).map((option) => ({ ...option })),
  );

  const save = () => {
    onSaveOptions(
      column.id,
      options
        .filter((option) => option.label.trim() !== '')
        .map((option) => ({ ...option, label: option.label.trim() })),
    );
    onClose();
  };

  return (
    <AnchoredPanel
      anchor={anchor}
      onClose={onClose}
      label={knowledgeT('editOptionsForValue', { v0: column.name })}
      width={272}
    >
      <div className="space-y-2 p-1.5">
        <OptionsListEditor options={options} onChange={setOptions} />
        <p className="px-0.5 text-[10.5px] leading-relaxed text-[var(--muted)]">
          {knowledgeT('removingOptionsKeepsExistingCellValuesUntilThey')}
        </p>
        <div className="flex justify-end border-t border-[var(--line)] pt-2">
          <button
            type="button"
            onClick={save}
            className="flex h-7 items-center rounded-[5px] bg-[var(--accent)] px-2.5 text-[11.5px] font-medium text-[var(--accent-foreground)] outline-none transition-colors hover:bg-[var(--accent-strong)]"
          >
            {knowledgeT('saveOptions')}
          </button>
        </div>
      </div>
    </AnchoredPanel>
  );
}

function OptionsEditor({
  draft,
  onChange,
}: {
  draft: ColumnDraft;
  onChange: (draft: ColumnDraft) => void;
}) {
  return (
    <div>
      <OptionsListEditor
        options={draft.options}
        onChange={(options) => onChange({ ...draft, options })}
      />
    </div>
  );
}

function OptionsListEditor({
  options,
  onChange,
}: {
  options: ColumnOptionDraft[];
  onChange: (options: ColumnOptionDraft[]) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const addOption = () => {
    onChange([
      ...options,
      { id: newOptionId(), label: '', color: palette[options.length % palette.length]! },
    ]);
  };
  return (
    <div className="space-y-1">
      {options.map((option, index) => (
        <div key={option.id} className="flex items-center gap-1.5">
          <button
            type="button"
            aria-label={knowledgeT('optionValueColor', { v0: index + 1 })}
            onClick={() =>
              onChange(
                options.map((candidate) =>
                  candidate.id === option.id
                    ? {
                        ...candidate,
                        color:
                          palette[
                            (palette.indexOf(option.color as (typeof palette)[number]) + 1) %
                              palette.length
                          ]!,
                      }
                    : candidate,
                ),
              )
            }
            className={cn(
              'size-3.5 shrink-0 rounded-full outline-none ring-1 ring-transparent transition-shadow hover:ring-[var(--focus-ring)]',
              optionColorClass(option.color, option.id).split(' ')[0],
            )}
          />
          <input
            type="text"
            value={option.label}
            placeholder={knowledgeT('optionValue', { v0: index + 1 })}
            aria-label={knowledgeT('optionValueName', { v0: index + 1 })}
            maxLength={120}
            onChange={(event) =>
              onChange(
                options.map((candidate) =>
                  candidate.id === option.id
                    ? { ...candidate, label: event.target.value }
                    : candidate,
                ),
              )
            }
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === 'Escape') event.preventDefault();
            }}
            className="h-[26px] min-w-0 flex-1 rounded-[5px] border border-[var(--line)] bg-[var(--panel)] px-1.5 text-[11.5px] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            aria-label={knowledgeT('removeOptionValue', { v0: index + 1 })}
            onClick={() => onChange(options.filter((candidate) => candidate.id !== option.id))}
            className="flex size-5 shrink-0 items-center justify-center rounded-[4px] text-[13px] leading-none text-[var(--muted)] outline-none transition-colors hover:bg-wash hover:text-[var(--err-ink)]"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={addOption}
        className="flex h-[26px] w-full items-center gap-1.5 rounded-[5px] px-1 text-[11.5px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash"
      >
        <Plus aria-hidden className="size-3" />
        {knowledgeT('addOption')}
      </button>
    </div>
  );
}

export function AddColumnTrigger({ onOpen }: { onOpen: (anchor: AnchorRect) => void }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <button
      type="button"
      aria-label={knowledgeT('newColumn')}
      onClick={(event) => onOpen(anchorRectOf(event.currentTarget))}
      className="flex h-full w-9 shrink-0 items-center justify-center text-[var(--muted)] outline-none transition-colors hover:bg-wash hover:text-[var(--ink)]"
    >
      <Plus aria-hidden className="size-3.5" />
    </button>
  );
}

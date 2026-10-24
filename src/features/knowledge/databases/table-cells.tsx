'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './table-cells.messages';
/**
 * 类型化单元格（U06）——按列类型渲染与就地编辑。
 *
 * 展示层走统一的克制样式：文本类原样、数字右对齐由网格决定、日期去时间尾巴、
 * 复选为一枚静音方框、选择类为彩色芯片、人员为目录名芯片、关联只读计数
 * （关联编辑随关系视图任务接入）。编辑器为单元格内浮层：Enter/失焦提交、
 * Escape 取消，选择/人员类经锚定面板挑选。提交值一律先过 cell-model 的
 * 契约镜像校验，非法输入就地提示、绝不落库。
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ArrowsLeftRight,
  CalendarBlank,
  CheckSquare,
  Link as LinkIcon,
  ListBullets,
  TextAa,
  Users,
  Hash,
} from '@phosphor-icons/react';
import type { PropertyDefinition, PropertyValue } from '@fob/shared/knowledge/contracts';
import { cn } from '@/lib/utils';
import {
  cellDraftOf,
  cellDisplayText,
  cellEditFailureText,
  commitCellEdit,
  isCellEmpty,
  optionColorClass,
  toggleArrayValue,
} from './cell-model';
import { AnchoredPanel, type AnchorRect } from './anchored-panel';

export const propertyTypeIcon = (type: PropertyDefinition['type']): ReactNode => {
  const className = 'size-3.5';
  switch (type) {
    case 'number':
      return <Hash aria-hidden className={className} />;
    case 'date':
      return <CalendarBlank aria-hidden className={className} />;
    case 'checkbox':
      return <CheckSquare aria-hidden className={className} />;
    case 'select':
    case 'multiSelect':
      return <ListBullets aria-hidden className={className} />;
    case 'person':
      return <Users aria-hidden className={className} />;
    case 'url':
      return <LinkIcon aria-hidden className={className} />;
    case 'relation':
      return <ArrowsLeftRight aria-hidden className={className} />;
    default:
      return <TextAa aria-hidden className={className} />;
  }
};

export function propertyTypeLabel(locale?: Locale): Record<PropertyDefinition['type'], string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    text: knowledgeT('text'),
    number: knowledgeT('number'),
    date: knowledgeT('date'),
    checkbox: knowledgeT('checkbox'),
    select: knowledgeT('select'),
    multiSelect: knowledgeT('multiSelect'),
    person: knowledgeT('people'),
    url: knowledgeT('link'),
    relation: knowledgeT('relation'),
  };
}

/** 人员目录条目：由视图层从 O02 成员目录载入。 */
export interface PersonOption {
  userId: string;
  name: string;
  email: string;
}

export function personNameOfFactory(
  members: readonly PersonOption[],
): (userId: string) => string | null {
  const index = new Map(members.map((member) => [member.userId, member.name] as const));
  return (userId) => index.get(userId) ?? null;
}

// ── 展示 ──

export function CellContent({
  column,
  value,
  personNameOf,
}: {
  column: PropertyDefinition;
  value: PropertyValue | undefined;
  personNameOf: (userId: string) => string | null;
}) {
  if (isCellEmpty(value)) return <span className="text-[var(--muted)]">—</span>;
  switch (column.type) {
    case 'checkbox':
      return (
        <span
          aria-hidden
          className={cn(
            'flex size-[15px] items-center justify-center rounded-[4px] border transition-colors',
            value === true
              ? 'border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]'
              : 'border-[var(--line-strong)] bg-[var(--panel)]',
          )}
        >
          {value === true ? (
            <svg viewBox="0 0 12 12" className="size-2.5" fill="none">
              <path
                d="M2.5 6.2 4.8 8.5 9.5 3.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : null}
        </span>
      );
    case 'select':
    case 'multiSelect': {
      const ids = Array.isArray(value) ? value : [value as string];
      const options = column.options ?? [];
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {ids
            .filter((id) => typeof id === 'string')
            .map((id) => {
              const option = options.find((candidate) => candidate.id === id);
              return (
                <span
                  key={id}
                  className={cn(
                    'max-w-full truncate rounded-[4px] px-1.5 py-px text-[11px] leading-[18px]',
                    optionColorClass(option?.color, id),
                  )}
                >
                  {option?.label ?? id}
                </span>
              );
            })}
        </span>
      );
    }
    case 'person': {
      const ids = Array.isArray(value) ? value : [];
      return (
        <span className="flex min-w-0 flex-wrap items-center gap-1">
          {ids.map((id) => (
            <span
              key={id}
              className="inline-flex max-w-full items-center gap-1 rounded-[4px] bg-[var(--raise)] px-1.5 py-px text-[11px] leading-[18px] text-[var(--ink-soft)]"
            >
              <span
                aria-hidden
                className="flex size-3.5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[9px] font-medium text-[var(--accent-ink)]"
              >
                {(personNameOf(id) ?? '?').slice(0, 1)}
              </span>
              <span className="truncate">{personNameOf(id) ?? id.slice(0, 8)}</span>
            </span>
          ))}
        </span>
      );
    }
    case 'url':
      return (
        <a
          href={typeof value === 'string' ? value : undefined}
          target="_blank"
          rel="noreferrer"
          className="truncate text-[var(--accent-ink)] underline decoration-[color-mix(in_srgb,var(--accent-ink)_40%,transparent)] underline-offset-2"
        >
          {cellDisplayText(column, value, personNameOf)}
        </a>
      );
    default:
      return <span className="truncate">{cellDisplayText(column, value, personNameOf)}</span>;
  }
}

// ── 编辑 ──

const inputClasses =
  'h-[26px] w-full rounded-[5px] border border-[var(--accent)] bg-[var(--panel)] px-2 text-[12px] text-[var(--ink)] outline-none';

/** 单元格编辑器：提交以 PropertyValue（null = 清空）回传，取消原样关闭。 */
export function CellEditor({
  column,
  value,
  anchor,
  members,
  onCommit,
  onCancel,
}: {
  column: PropertyDefinition;
  value: PropertyValue | undefined;
  anchor: AnchorRect;
  members: readonly PersonOption[];
  onCommit: (next: PropertyValue) => void;
  onCancel: () => void;
}) {
  const needsPanel =
    column.type === 'select' || column.type === 'multiSelect' || column.type === 'person';
  if (needsPanel) {
    return (
      <SelectionEditor
        column={column}
        value={value}
        anchor={anchor}
        members={members}
        onCommit={onCommit}
        onCancel={onCancel}
      />
    );
  }
  return <ScalarEditor column={column} value={value} onCommit={onCommit} onCancel={onCancel} />;
}

function ScalarEditor({
  column,
  value,
  onCommit,
  onCancel,
}: {
  column: PropertyDefinition;
  value: PropertyValue | undefined;
  onCommit: (next: PropertyValue) => void;
  onCancel: () => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const initial = useMemo(() => cellDraftOf(column, value), [column, value]);
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const commit = () => {
    if (draft === initial) {
      onCancel();
      return;
    }
    const result = commitCellEdit(column, draft);
    if (!result.ok) {
      setError(cellEditFailureText(locale)[result.failure.kind]);
      return;
    }
    onCommit(result.value);
  };

  const inputType = column.type === 'number' ? 'text' : column.type === 'date' ? 'text' : 'text';
  const placeholder =
    column.type === 'date'
      ? 'YYYY-MM-DD'
      : column.type === 'number'
        ? knowledgeT('number')
        : column.type === 'url'
          ? 'https://…'
          : knowledgeT('enterText');

  return (
    <div className="absolute inset-0 z-10 flex items-center bg-[var(--panel)]" onBlur={commit}>
      <input
        ref={inputRef}
        type={inputType}
        value={draft}
        placeholder={placeholder}
        aria-label={knowledgeT('editValue', { v0: column.name })}
        aria-invalid={error !== null}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        className={cn(inputClasses, 'h-full rounded-[4px]')}
      />
      {error ? (
        <span
          role="alert"
          className="absolute left-0 top-full z-20 mt-1 rounded-[5px] border border-[color-mix(in_srgb,var(--err-ink)_30%,transparent)] bg-[var(--elevated)] px-2 py-1 text-[11px] text-[var(--err-ink)]"
        >
          {error}
        </span>
      ) : null}
    </div>
  );
}

function SelectionEditor({
  column,
  value,
  anchor,
  members,
  onCommit,
  onCancel,
}: {
  column: PropertyDefinition;
  value: PropertyValue | undefined;
  anchor: AnchorRect;
  members: readonly PersonOption[];
  onCommit: (next: PropertyValue) => void;
  onCancel: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [query, setQuery] = useState('');
  const isPerson = column.type === 'person';
  const options = useMemo(() => {
    if (isPerson) {
      return members
        .filter(
          (member) =>
            member.name.toLowerCase().includes(query.toLowerCase()) ||
            member.email.toLowerCase().includes(query.toLowerCase()),
        )
        .map((member) => ({
          id: member.userId,
          label: member.name,
          hint: member.email,
          color: undefined as string | undefined,
        }));
    }
    return (column.options ?? [])
      .filter((option) => option.label.toLowerCase().includes(query.toLowerCase()))
      .map((option) => ({
        id: option.id,
        label: option.label,
        hint: undefined,
        color: option.color,
      }));
  }, [column, isPerson, members, query]);

  const current: string[] = Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : value === undefined || value === null || typeof value !== 'string'
      ? []
      : [value];
  const multiple = column.type === 'multiSelect' || isPerson;

  const pick = (id: string) => {
    if (!multiple) {
      onCommit(current[0] === id ? null : id);
      return;
    }
    onCommit(toggleArrayValue(current, id));
  };

  return (
    <AnchoredPanel
      anchor={anchor}
      onClose={onCancel}
      label={knowledgeT('editValue', { v0: column.name })}
      width={252}
      className="p-1.5"
    >
      <input
        autoFocus
        type="text"
        value={query}
        placeholder={isPerson ? knowledgeT('searchMembers') : knowledgeT('searchOptions')}
        aria-label={knowledgeT('searchValue', {
          v0: isPerson ? knowledgeT('members') : knowledgeT('options'),
        })}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && options.length > 0) {
            event.preventDefault();
            pick(options[0]!.id);
          }
        }}
        className={cn(inputClasses, 'mb-1')}
      />
      <div
        role="listbox"
        aria-label={knowledgeT('valueOptions', { v0: column.name })}
        className="max-h-56 overflow-y-auto"
      >
        {options.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-[var(--muted)]">
            {isPerson
              ? knowledgeT('noMatchingMembers')
              : knowledgeT('noOptionsYetAddOptionsInTheColumn')}
          </p>
        ) : (
          options.map((option) => {
            const selected = current.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => pick(option.id)}
                className="flex h-[30px] w-full items-center gap-2 rounded-[5px] px-2 text-left outline-none transition-colors hover:bg-wash focus-visible:bg-wash"
              >
                {isPerson ? (
                  <span
                    aria-hidden
                    className="flex size-4 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[9px] font-medium text-[var(--accent-ink)]"
                  >
                    {option.label.slice(0, 1)}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    className={cn(
                      'size-2.5 shrink-0 rounded-full',
                      optionColorClass(option.color, option.id).split(' ')[0],
                    )}
                  />
                )}
                <span className="min-w-0 flex-1 truncate">
                  {option.label}
                  {option.hint ? (
                    <span className="ml-1.5 text-[10.5px] text-[var(--muted)]">{option.hint}</span>
                  ) : null}
                </span>
                {selected ? (
                  <span aria-hidden className="text-[11px] text-[var(--accent-ink)]">
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })
        )}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-[var(--line)] pt-1.5">
        <button
          type="button"
          onClick={() => onCommit(null)}
          className="rounded-[5px] px-2 py-1 text-[11px] text-[var(--muted-strong)] outline-none transition-colors hover:bg-wash"
        >
          {knowledgeT('clear')}
        </button>
        {multiple ? (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-[5px] bg-[var(--accent)] px-2.5 py-1 text-[11px] font-medium text-[var(--accent-foreground)] outline-none transition-colors hover:bg-[var(--accent-strong)]"
          >
            {knowledgeT('done')}
          </button>
        ) : null}
      </div>
    </AnchoredPanel>
  );
}

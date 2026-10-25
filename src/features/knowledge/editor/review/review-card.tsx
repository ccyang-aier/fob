'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './review-card.messages';
/**
 * One reviewable suggestion as a card (S02, design §4.5/§9.3).
 *
 * The card body is the locate affordance — click or Enter scrolls the
 * suggestion into reading position and selects it; accept/reject are separate
 * real buttons so a decision never fires from an accidental locate. Every
 * control carries its disabled reason (readonly page, empty document) in its
 * title, mirroring the honest matrix of `reviewActionsView`.
 */

import { ArrowsLeftRight, Check, Minus, Plus, X } from '@/components/icons';
import type { SuggestionDecision } from '@fob/shared/knowledge/schema/suggestions';
import { cn } from '@/lib/utils';
import { authorBadgeGlyph } from './author';
import type { ReviewRow, SuggestionKind } from './review-model';

function kindMeta(
  locale?: Locale,
): Record<SuggestionKind, { label: string; icon: typeof Plus; className: string }> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    insert: {
      label: knowledgeT('insert'),
      icon: Plus,
      className:
        'text-[var(--ok-ink)] border-[color-mix(in_srgb,var(--ok-ink)_32%,transparent)] bg-[color-mix(in_srgb,var(--ok-ink)_8%,transparent)]',
    },
    delete: {
      label: knowledgeT('delete'),
      icon: Minus,
      className:
        'text-[var(--err-ink)] border-[color-mix(in_srgb,var(--err-ink)_32%,transparent)] bg-[color-mix(in_srgb,var(--err-ink)_8%,transparent)]',
    },
    replace: {
      label: knowledgeT('replace'),
      icon: ArrowsLeftRight,
      className:
        'text-[var(--accent-ink)] border-[color-mix(in_srgb,var(--accent-ink)_32%,transparent)] bg-[var(--accent-soft)]',
    },
  };
}

const authorChipClass: Record<ReviewRow['author']['kind'], string> = {
  human: 'text-[var(--muted-strong)] border-[var(--line-strong)] bg-[var(--panel)]',
  agent: 'text-[var(--accent-ink)] border-[var(--accent-soft-line)] bg-[var(--accent-soft)]',
  mcp: 'text-[var(--warn-ink)] border-[var(--warn-soft-line)] bg-[var(--warn-soft)]',
  restore: 'text-[var(--muted-strong)] border-[var(--line-strong)] bg-[var(--surface-subtle)]',
};

function DecisionButton({
  label,
  onClick,
  disabled,
  reason,
  tone,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  reason: string | null;
  tone: 'accept' | 'reject';
  children: React.ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <button
      type="button"
      aria-label={label}
      title={disabled ? (reason ?? knowledgeT('currentlyUnavailable')) : label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex h-6 items-center gap-1 rounded-[6px] border px-2 text-[11px] font-medium outline-none',
        'transition-[background-color,border-color,opacity,transform] duration-100',
        'focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
        'active:scale-[0.97]',
        tone === 'accept'
          ? 'border-[color-mix(in_srgb,var(--ok-ink)_38%,transparent)] text-[var(--ok-ink)]'
          : 'border-[color-mix(in_srgb,var(--err-ink)_30%,transparent)] text-[var(--err-ink)]',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : tone === 'accept'
            ? 'bg-[color-mix(in_srgb,var(--ok-ink)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--ok-ink)_15%,transparent)]'
            : 'hover:bg-[color-mix(in_srgb,var(--err-ink)_10%,transparent)]',
      )}
    >
      {children}
    </button>
  );
}

export function ReviewCard({
  row,
  active,
  canDecide,
  disabledReason,
  onLocate,
  onDecide,
}: {
  row: ReviewRow;
  active: boolean;
  canDecide: boolean;
  disabledReason: string | null;
  onLocate: (suggestionId: string) => void;
  onDecide: (suggestionId: string, decision: SuggestionDecision) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const kind = kindMeta(locale)[row.kind];
  const KindIcon = kind.icon;
  const locateLabel = knowledgeT('locateSuggestionValueValueValue', {
    v0: kind.label,
    v1: row.author.label,
    v2: row.excerpt,
  });

  return (
    <li
      data-suggestion-id={row.suggestionId}
      className={cn(
        'rounded-[8px] border transition-[border-color,box-shadow] duration-150',
        active
          ? 'border-[color-mix(in_srgb,var(--accent)_45%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--accent)_25%,transparent)]'
          : 'border-[var(--line)] hover:border-[var(--line-strong)]',
        canDecide ? 'bg-[var(--panel)]' : 'bg-[var(--surface-subtle)]',
      )}
    >
      <button
        type="button"
        aria-label={locateLabel}
        title={knowledgeT('locateThisSuggestionInTheDocument')}
        onClick={() => onLocate(row.suggestionId)}
        className={cn(
          'block w-full rounded-t-[8px] px-3 pb-1.5 pt-2.5 text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--focus-ring)]',
        )}
      >
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              'flex h-[17px] items-center gap-0.5 rounded-[4px] border px-1.5 text-[10px] font-semibold leading-none',
              kind.className,
            )}
          >
            <KindIcon aria-hidden className="size-2.5" />
            {kind.label}
          </span>
          {row.scope !== 'text' ? (
            <span
              title={knowledgeT('thisSuggestionAppliesToAWholeBlockImage')}
              className="flex h-[17px] items-center rounded-[4px] border border-[var(--line)] bg-[var(--surface-subtle)] px-1.5 text-[10px] font-medium leading-none text-[var(--muted-strong)]"
            >
              {knowledgeT('block')}
            </span>
          ) : null}
          <span
            className={cn(
              'flex h-[17px] items-center gap-1 rounded-[4px] border px-1.5 text-[10px] font-medium leading-none',
              authorChipClass[row.author.kind],
            )}
            title={`${row.author.source}${row.author.detail ? ` · ${row.author.detail}` : ''}`}
          >
            <span aria-hidden className="font-semibold tracking-[0.02em]">
              {authorBadgeGlyph(row.author.kind)}
            </span>
            {row.author.label}
          </span>
          <span
            className="ml-auto shrink-0 whitespace-nowrap text-[10px] text-[var(--muted)]"
            title={row.createdAt}
          >
            {row.createdAtLabel}
          </span>
        </div>
        <p className="mt-1.5 line-clamp-2 break-words text-[12px] leading-[1.55] text-[var(--ink-soft)]">
          {row.excerpt}
        </p>
      </button>
      <div className="flex items-center justify-end gap-1.5 px-3 pb-2.5 pt-0.5">
        <DecisionButton
          label={knowledgeT('rejectThisSuggestion')}
          tone="reject"
          disabled={!canDecide}
          reason={disabledReason}
          onClick={() => onDecide(row.suggestionId, 'reject')}
        >
          <X aria-hidden className="size-3" />
          {knowledgeT('reject')}
        </DecisionButton>
        <DecisionButton
          label={knowledgeT('acceptThisSuggestion')}
          tone="accept"
          disabled={!canDecide}
          reason={disabledReason}
          onClick={() => onDecide(row.suggestionId, 'accept')}
        >
          <Check aria-hidden className="size-3" />
          {knowledgeT('accept')}
        </DecisionButton>
      </div>
    </li>
  );
}

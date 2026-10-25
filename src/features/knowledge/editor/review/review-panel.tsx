'use client';
import { usePageVisible } from '@/lib/page-visibility';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './review-panel.messages';
/**
 * The suggestion review sidebar (S02, design §4.5/§9.3): one honest surface
 * for every outstanding suggestion — humans' and agents' share the single
 * S01 path, so every card is the same decision away from the body.
 *
 * Behavior contract:
 *
 * - The rail appears with the first suggestion of a batch; a deliberate close
 *   (button or Escape) keeps it closed until the batch is fully resolved —
 *   a collapsed tab with the live count keeps it one click away.
 * - The stats strip and the batch accept/reject buttons describe the same
 *   document the cards list; both batch buttons run one S01 transaction, so
 *   the whole batch is a single Yjs transaction and one undo step (B08).
 * - Readonly pages show every control disabled with its reason — a reviewer
 *   without edit rights can still locate and read every suggestion.
 */

import { useEffect, useState } from 'react';
import { Check, CheckCircle, Prohibit, X } from '@/components/icons';
import type { Editor } from '@tiptap/react';
import { cn } from '@/lib/utils';
import { authorBadgeGlyph } from './author';
import { ReviewCard } from './review-card';
import { useReviewPanel } from './use-review-panel';

function BatchButton({
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
        'flex h-7 flex-1 items-center justify-center gap-1.5 rounded-[7px] border text-[11.5px] font-medium outline-none',
        'transition-[background-color,border-color,opacity,transform] duration-100',
        'focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
        'active:scale-[0.98]',
        tone === 'accept'
          ? 'border-[color-mix(in_srgb,var(--ok-ink)_38%,transparent)] text-[var(--ok-ink)]'
          : 'border-[color-mix(in_srgb,var(--err-ink)_30%,transparent)] text-[var(--err-ink)]',
        disabled
          ? 'cursor-not-allowed opacity-40'
          : tone === 'accept'
            ? 'bg-[color-mix(in_srgb,var(--ok-ink)_8%,transparent)] hover:bg-[color-mix(in_srgb,var(--ok-ink)_14%,transparent)]'
            : 'hover:bg-[color-mix(in_srgb,var(--err-ink)_10%,transparent)]',
      )}
    >
      {children}
    </button>
  );
}

/**
 * The rail's visibility, derived instead of synchronized:
 *
 * - `auto` opens the rail with every new batch of suggestions;
 * - a deliberate close (`closed` — button or Escape) keeps it collapsed while
 *   that batch is being reviewed, leaving the count tab one click away;
 * - once a batch fully resolves (total back to zero) the intent returns to
 *   `auto`, so the next batch opens on its own again. The reset is the
 *   render-phase prop-adjustment pattern (setState guarded by a change in
 *   derived data), not an effect.
 */
type RailIntent = 'auto' | 'open' | 'closed';

export function ReviewPanel({ editor, editable }: { editor: Editor | null; editable: boolean }) {
  const visible = usePageVisible();
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const view = useReviewPanel(editor, editable);
  const [intent, setIntent] = useState<RailIntent>('auto');
  const [lastTotal, setLastTotal] = useState(view.stats.total);
  const { total, inserts, deletes, replaces, blockScoped, authors } = view.stats;

  if (total !== lastTotal) {
    setLastTotal(total);
    if (total === 0 && intent !== 'auto') setIntent('auto');
  }
  const open = total > 0 && intent !== 'closed';

  // Escape closes the rail — the same contract the shell's assistant rail follows.
  useEffect(() => {
    if (!open || !visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIntent('closed');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, visible]);

  if (!editor || total === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        aria-label={knowledgeT('expandSuggestionReviewValue', { v0: total })}
        aria-expanded={false}
        onClick={() => setIntent('open')}
        className={cn(
          'mt-4 flex h-7 shrink-0 animate-in fade-in slide-in-from-right-2 items-center gap-1.5 self-start rounded-l-[7px] duration-150',
          'border border-r-0 border-[var(--line)] bg-[var(--panel)]',
          'pl-2.5 pr-2 text-[11px] font-medium text-[var(--muted-strong)] shadow-[0_2px_10px_rgba(18,23,31,0.08)] outline-none',
          'transition-[color,background-color,transform] duration-100',
          'focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
          'hover:bg-[var(--surface-subtle)] hover:text-[var(--ink)] active:scale-[0.98]',
        )}
      >
        <CheckCircle aria-hidden className="size-3.5 text-[var(--accent-ink)]" />
        {knowledgeT('reviewCount', { v0: total })}
      </button>
    );
  }

  return (
    <aside
      aria-label={knowledgeT('suggestionReview')}
      className={cn(
        'flex h-full w-[300px] shrink-0 animate-in fade-in slide-in-from-right-2 flex-col duration-150',
        'border-l border-[var(--line)] bg-[var(--panel)]',
      )}
    >
      <header className="flex h-[42px] shrink-0 items-center gap-2 border-b border-[var(--line)] pl-4 pr-2">
        <CheckCircle aria-hidden className="size-3.5 shrink-0 text-[var(--accent-ink)]" />
        <span className="text-[12px] font-medium text-[var(--ink)]">
          {knowledgeT('suggestionReview')}
        </span>
        <span
          role="status"
          className="flex h-[17px] items-center rounded-full bg-[var(--accent-soft)] px-1.5 text-[10px] font-semibold leading-none text-[var(--accent-ink)]"
        >
          {total}
        </span>
        <button
          type="button"
          aria-label={knowledgeT('collapseSuggestionReview')}
          title={knowledgeT('collapseSuggestionReviewEsc')}
          onClick={() => setIntent('closed')}
          className={cn(
            'ml-auto flex size-7 items-center justify-center rounded-[6px] text-[var(--muted)] outline-none',
            'transition-[background-color,color] duration-100',
            'focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
            'hover:bg-[var(--raise)] hover:text-[var(--ink)] active:scale-[0.96]',
          )}
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>

      <div className="shrink-0 border-b border-[var(--line)] px-4 py-2.5">
        <p className="text-[11px] leading-[1.6] text-[var(--muted-strong)]">
          {[
            knowledgeT(total === 1 ? 'oneSuggestion' : 'suggestionCount', { count: total }),
            knowledgeT(inserts === 1 ? 'oneInsertion' : 'insertionCount', { count: inserts }),
            knowledgeT(deletes === 1 ? 'oneDeletion' : 'deletionCount', { count: deletes }),
            knowledgeT(replaces === 1 ? 'oneReplacement' : 'replacementCount', { count: replaces }),
          ].join(' · ')}
          {blockScoped > 0
            ? knowledgeT(blockScoped === 1 ? 'oneBlockSuggestion' : 'valueBlockSuggestions', {
                v0: blockScoped,
              })
            : ''}
        </p>
        {authors.length > 0 ? (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {authors.map(({ badge, count }) => (
              <span
                key={`${badge.kind}:${badge.label}:${badge.detail ?? ''}`}
                title={`${badge.source}${badge.detail ? ` · ${badge.detail}` : ''}`}
                className="flex h-[17px] items-center gap-1 rounded-[4px] border border-[var(--line)] bg-[var(--surface-subtle)] px-1.5 text-[10px] font-medium leading-none text-[var(--muted-strong)]"
              >
                <span aria-hidden className="font-semibold tracking-[0.02em]">
                  {authorBadgeGlyph(badge.kind)}
                </span>
                {badge.label}
                {authors.length > 1 ? <span className="text-[var(--muted)]">{count}</span> : null}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex shrink-0 gap-1.5 px-3 py-2.5">
        <BatchButton
          label={knowledgeT('rejectAllValue', { v0: total })}
          tone="reject"
          disabled={!view.actions.canDecideAll}
          reason={view.actions.disabledReason}
          onClick={() => view.decide('reject')}
        >
          <Prohibit aria-hidden className="size-3" />
          {knowledgeT('rejectAll')}
        </BatchButton>
        <BatchButton
          label={knowledgeT('acceptAllValue', { v0: total })}
          tone="accept"
          disabled={!view.actions.canDecideAll}
          reason={view.actions.disabledReason}
          onClick={() => view.decide('accept')}
        >
          <Check aria-hidden className="size-3" />
          {knowledgeT('acceptAll')}
        </BatchButton>
      </div>

      <ul
        aria-label={knowledgeT('suggestions2')}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 pb-4"
      >
        {view.rows.map((row) => (
          <ReviewCard
            key={row.suggestionId}
            row={row}
            active={view.activeId === row.suggestionId}
            canDecide={view.actions.canDecide}
            disabledReason={view.actions.disabledReason}
            onLocate={view.locate}
            onDecide={(suggestionId, decision) => view.decide(decision, [suggestionId])}
          />
        ))}
      </ul>
    </aside>
  );
}

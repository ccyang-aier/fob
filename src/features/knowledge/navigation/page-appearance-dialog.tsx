'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './page-appearance-dialog.messages';
/**
 * Icon / cover dialog of one page (U03). Both are metadata writes of the T01
 * contract (`icon` ≤ 200, `cover` ≤ 2048 — a URL the assets task will later
 * mint through uploads); the dialog edits locally and commits once, so the
 * optimistic operation applies as a single update, not per keystroke. The
 * stage mounts this component with a `key` of page+mode, so the draft state
 * initializes fresh per target instead of syncing through an effect.
 */

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { DialogButton, ModalDialog } from '../organization/ui';
import { pageDisplayTitle } from './tree-model';

/** A curated, category-free set that covers common doc marks; enough to be useful, small enough to scan. */
const iconChoices = [
  '📄',
  '📝',
  '📘',
  '📌',
  '🗂️',
  '📊',
  '📈',
  '🧭',
  '🧩',
  '🛠️',
  '💡',
  '🎯',
  '🚀',
  '🏗️',
  '🧪',
  '🔬',
  '🎨',
  '🗓️',
  '✅',
  '⚖️',
  '🔒',
  '🌍',
  '🌱',
  '⭐',
  '🔥',
  '💬',
  '📦',
  '🧠',
  '🫧',
  '🏁',
] as const;

export function PageAppearanceDialog({
  open,
  mode,
  page,
  onClose,
  onApply,
}: {
  open: boolean;
  mode: 'icon' | 'cover';
  page: { id: string; title: string; icon: string | null; cover: string | null } | null;
  onClose: () => void;
  onApply: (pageId: string, patch: { icon?: string | null; cover?: string | null }) => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const [icon, setIcon] = useState<string | null>(() => page?.icon ?? null);
  const [cover, setCover] = useState(() => page?.cover ?? '');

  if (!page) return null;

  const trimmedCover = cover.trim();
  const coverChanged = trimmedCover !== (page.cover ?? '');
  const coverInvalid = trimmedCover.length > 0 && !/^https?:\/\/\S+$/i.test(trimmedCover);

  function apply() {
    if (mode === 'icon') {
      onApply(page!.id, { icon });
    } else {
      if (coverInvalid) return;
      onApply(page!.id, { cover: trimmedCover.length === 0 ? null : trimmedCover });
    }
    onClose();
  }

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title={mode === 'icon' ? knowledgeT('changeIcon') : knowledgeT('setCover')}
      description={knowledgeT('valueForValue', {
        v0: pageDisplayTitle(page, locale),
        v1:
          mode === 'icon'
            ? knowledgeT('theIconAppearsInThePageTreeAnd')
            : knowledgeT('theCoverAppearsAtTheTopOfThe'),
      })}
      width={mode === 'icon' ? 'w-[380px]' : 'w-[440px]'}
      footer={
        <>
          <DialogButton onClick={onClose}>{knowledgeT('cancel')}</DialogButton>
          <DialogButton
            variant="primary"
            autoFocus
            disabled={mode === 'icon' ? icon === page.icon : !coverChanged || coverInvalid}
            onClick={apply}
          >
            {knowledgeT('apply')}
          </DialogButton>
        </>
      }
    >
      {mode === 'icon' ? (
        <div
          role="radiogroup"
          aria-label={knowledgeT('iconPicker')}
          className="grid grid-cols-10 gap-1"
        >
          {iconChoices.map((choice) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={icon === choice}
              onClick={() => setIcon(choice)}
              className={cn(
                'flex size-8 items-center justify-center rounded-[6px] border text-[15px] leading-none outline-none transition-colors',
                icon === choice
                  ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)]'
                  : 'border-transparent hover:border-[var(--line)] hover:bg-[var(--surface-subtle)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
              )}
            >
              {choice}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            aria-checked={icon === null}
            onClick={() => setIcon(null)}
            className={cn(
              'col-span-2 flex h-8 items-center justify-center rounded-[6px] border text-[10.5px] text-[var(--muted-strong)] outline-none transition-colors',
              icon === null
                ? 'border-[var(--accent-soft-line)] bg-[var(--accent-soft)]'
                : 'border-transparent hover:border-[var(--line)] hover:bg-[var(--surface-subtle)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]',
            )}
          >
            {knowledgeT('noIcon')}
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--muted-strong)]">
              {knowledgeT('coverImageUrl')}
            </span>
            <input
              value={cover}
              maxLength={2048}
              autoFocus
              placeholder="https://…"
              aria-invalid={coverInvalid || undefined}
              onChange={(event) => setCover(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !coverInvalid && coverChanged) apply();
              }}
              className={cn(
                'h-8 rounded-[6px] border bg-panel px-2.5 text-[12px] text-[var(--ink)] outline-none transition-colors placeholder:text-[var(--muted)]',
                coverInvalid
                  ? 'border-[var(--err-ink)]'
                  : 'border-[var(--line)] focus:border-[var(--accent)]',
              )}
            />
            {coverInvalid ? (
              <span className="text-[10.5px] text-[var(--err-ink)]">
                {knowledgeT('coverMustUseAnHttpSImageUrl')}
              </span>
            ) : null}
          </label>
          {trimmedCover.length > 0 && !coverInvalid ? (
            // eslint-disable-next-line @next/next/no-img-element -- metadata preview of a user-provided URL, not a bundled asset
            <img
              src={trimmedCover}
              alt={knowledgeT('coverPreview')}
              className="h-24 w-full rounded-[7px] border border-[var(--line)] object-cover"
              onError={(event) => {
                event.currentTarget.style.opacity = '0.25';
              }}
            />
          ) : (
            <p className="text-[10.5px] leading-relaxed text-[var(--muted)]">
              {knowledgeT('leaveEmptyAndApplyToRemoveTheCover')}
            </p>
          )}
        </div>
      )}
    </ModalDialog>
  );
}

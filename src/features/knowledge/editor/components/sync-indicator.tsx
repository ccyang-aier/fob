'use client';

/**
 * The B04 sync indicator of the page editor (E03): one status label that names where
 * the document stands — loading, local-only, syncing, synced, offline or
 * rejected — derived entirely from `syncIndicatorView`, never from invented
 * state. Label changes announce politely; the hint rides along as tooltip.
 */

import { CheckCircle, SpinnerGap } from '@phosphor-icons/react';
import { cn } from '@/lib/utils';
import type { SyncIndicatorView, SyncTone } from '../editor-state';

const toneClasses: Record<SyncTone, string> = {
  quiet: 'text-[var(--muted-strong)]',
  progress: 'text-[var(--info-ink)]',
  ok: 'text-[var(--ok-ink)]',
  warn: 'text-[var(--warn-ink)]',
  error: 'text-[var(--err-ink)]',
};

const dotClasses: Record<SyncTone, string> = {
  quiet: 'bg-[var(--muted)]',
  progress: 'bg-[var(--info)]',
  ok: 'bg-[var(--ok-ink)]',
  warn: 'bg-[var(--warn-ink)]',
  error: 'bg-[var(--err-ink)]',
};

export function SyncIndicator({ view }: { view: SyncIndicatorView }) {
  return (
    <span
      role="status"
      title={view.hint}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 text-[13px] transition-colors',
        toneClasses[view.tone],
      )}
    >
      {view.busy ? (
        <SpinnerGap aria-hidden className="size-3 animate-spin" />
      ) : view.tone === 'ok' ? (
        <CheckCircle aria-hidden className="size-3.5" weight="fill" />
      ) : (
        <span
          aria-hidden
          className={cn('size-1.5 rounded-full transition-colors', dotClasses[view.tone], view.tone === 'progress' && 'animate-pulse')}
        />
      )}
      {view.label}
    </span>
  );
}

'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './canvas-states.messages';
/**
 * Shared state surfaces of the knowledge shell (U02): the four honest states —
 * loading, error, forbidden (and the empty / redirect variants) — as one
 * centered canvas layout plus the pulse skeletons for the tree and the canvas.
 * Copy stays product-facing; each state names what failed and offers the next
 * action instead of fabricating content.
 */

import type { ReactNode } from 'react';
import { CircleNotch, SignOut, Warning, XCircle } from '@/components/icons';
import { cn } from '@/lib/utils';

export function CanvasState({
  icon,
  title,
  hint,
  actions,
  tone = 'quiet',
  announce,
  className,
}: {
  icon?: ReactNode;
  title: string;
  hint?: ReactNode;
  actions?: ReactNode;
  tone?: 'quiet' | 'error' | 'accent';
  announce?: 'polite' | 'assertive';
  className?: string;
}) {
  return (
    <div
      role={announce === 'assertive' ? 'alert' : announce === 'polite' ? 'status' : undefined}
      className={cn(
        'flex h-full min-h-[240px] flex-col items-center justify-center gap-1 px-8 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <span
          aria-hidden
          className={cn(
            'flex size-10 items-center justify-center rounded-[10px] border',
            tone === 'error' &&
              'border-[color-mix(in_srgb,var(--err-ink)_28%,transparent)] bg-[color-mix(in_srgb,var(--err-ink)_8%,transparent)] text-[var(--err-ink)]',
            tone === 'accent' &&
              'border-[var(--accent-soft-line)] bg-[var(--accent-soft)] text-[var(--accent-ink)]',
            tone === 'quiet' &&
              'border-[var(--line)] bg-[var(--surface-subtle)] text-[var(--muted-strong)]',
          )}
        >
          {icon}
        </span>
      ) : null}
      <p className="mt-3 text-[13px] font-medium tracking-[-0.005em] text-[var(--ink)]">{title}</p>
      {hint ? (
        <p className="mt-1.5 max-w-[440px] text-[11.5px] leading-relaxed text-[var(--muted-strong)]">
          {hint}
        </p>
      ) : null}
      {actions ? <div className="mt-4 flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CanvasSpinner({ label }: { label: string }) {
  return (
    <CanvasState
      icon={<CircleNotch className="size-5 animate-spin" aria-hidden />}
      title={label}
      announce="polite"
    />
  );
}

export function CanvasError({
  title: providedTitle,
  detail,
  onRetry,
  retryLabel: providedRetryLabel,
}: {
  title?: string;
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const title = providedTitle ?? knowledgeT('unableToLoad');
  const retryLabel = providedRetryLabel ?? knowledgeT('retry');

  return (
    <CanvasState
      icon={<XCircle className="size-5" aria-hidden />}
      title={title}
      hint={detail}
      tone="error"
      announce="assertive"
      actions={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="h-8 rounded-[6px] border border-[var(--line)] bg-[var(--panel)] px-3 text-[11.5px] font-medium text-[var(--ink-soft)] outline-none transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--surface-subtle)] focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)]"
          >
            {retryLabel}
          </button>
        ) : undefined
      }
    />
  );
}

export function CanvasForbidden({
  title: providedTitle,
  detail,
  actions,
}: {
  title?: string;
  detail?: ReactNode;
  actions?: ReactNode;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const title = providedTitle ?? knowledgeT('accessDenied');

  return (
    <CanvasState
      icon={<Warning className="size-5" aria-hidden />}
      title={title}
      hint={detail}
      actions={actions}
      announce="polite"
    />
  );
}

export function CanvasRedirect({ detail }: { detail?: ReactNode }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <CanvasState
      icon={<SignOut className="size-5" aria-hidden />}
      title={knowledgeT('openingSignIn')}
      hint={detail ?? knowledgeT('yourSessionNeedsVerificationYouWillReturnHere')}
      announce="polite"
    />
  );
}

/** Pulse rows for the tree while the teamspace directory resolves. */
export function TreeSkeletonRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-1 px-2 pt-1" aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className="h-[26px] animate-pulse rounded-[6px] bg-[var(--raise)]"
          style={{
            width: `${88 - (index % 3) * 18}%`,
            marginLeft: index % 3 === 2 ? 14 : 0,
            animationDelay: `${index * 90}ms`,
          }}
        />
      ))}
    </div>
  );
}

/** Pulse card lines for the canvas while the access snapshot resolves. */
export function CanvasSkeletonCard() {
  return (
    <div className="mx-auto w-full max-w-[520px] space-y-3 p-6" aria-hidden>
      <div className="h-6 w-[180px] animate-pulse rounded-[6px] bg-[var(--raise)]" />
      <div className="h-[3px] w-full animate-pulse rounded bg-[var(--raise)]" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex items-center gap-3">
          <div className="size-7 animate-pulse rounded-full bg-[var(--raise)]" />
          <div
            className="h-[3px] flex-1 animate-pulse rounded bg-[var(--raise)]"
            style={{ width: `${70 - row * 12}%` }}
          />
        </div>
      ))}
    </div>
  );
}

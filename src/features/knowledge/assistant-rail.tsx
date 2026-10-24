'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './assistant-rail.messages';
/**
 * The reserved right column of the knowledge shell (U02): review (S02) and the
 * AI side panel (J06) mount here later. Until then the rail renders its honest
 * placeholder — no fabricated chat or review UI — and stays out of the way:
 * closed by default, opened from the canvas header, closable with Escape.
 */

import { useEffect } from 'react';
import { usePageVisible } from '@/lib/page-visibility';
import { ChatCircleDots, X } from '@phosphor-icons/react';
import { motion } from 'motion/react';
import { CanvasState } from './canvas-states';
import { cn } from '@/lib/utils';

export function AssistantRailToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <button
      type="button"
      aria-label={
        open ? knowledgeT('collapseReviewAndAiPanel') : knowledgeT('expandReviewAndAiPanel')
      }
      aria-pressed={open}
      data-active={open || undefined}
      title={open ? knowledgeT('collapseReviewAndAiPanel') : knowledgeT('expandReviewAndAiPanel')}
      onClick={onToggle}
      className={cn(
        'fob-action flex h-7 cursor-pointer items-center gap-1.5 rounded-[6px] px-2 text-[11px] font-medium outline-none',
        open
          ? 'bg-[var(--accent-soft)] text-[var(--accent-ink)]'
          : 'text-[var(--muted-strong)]',
      )}
    >
      <ChatCircleDots aria-hidden className="size-3.5" />
      {knowledgeT('reviewAndAi')}
    </button>
  );
}

export function AssistantRail({ open, onClose }: { open: boolean; onClose: () => void }) {
  const visible = usePageVisible();
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  useEffect(() => {
    if (!open || !visible) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose, visible]);

  if (!open) return null;

  return (
    <motion.aside
      aria-label={knowledgeT('reviewAndAi')}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
      className="flex h-full w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]"
    >
      <header className="flex h-[42px] shrink-0 items-center justify-between border-b border-[var(--line)] pl-4 pr-2">
        <span className="text-[12px] font-medium text-[var(--ink)]">
          {knowledgeT('reviewAndAi')}
        </span>
        <button
          type="button"
          aria-label={knowledgeT('collapseReviewAndAiPanel')}
          onClick={onClose}
          className="fob-action flex size-7 cursor-pointer items-center justify-center rounded-[6px] text-[var(--muted)] outline-none"
        >
          <X aria-hidden className="size-4" />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        <CanvasState
          icon={<ChatCircleDots className="size-5" aria-hidden weight="regular" />}
          title={knowledgeT('reviewAndAiAssistanceWillBeAvailableHere')}
          announce="polite"
        />
      </div>
    </motion.aside>
  );
}

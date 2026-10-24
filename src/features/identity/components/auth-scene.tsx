'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-scene.messages';

/**
 * Shared layout for every Fob authentication surface (A04): a quiet, centered
 * stage over the app shell background with the Fob mark, one card, and a
 * restrained entrance. All colors come from the workbench design tokens, so
 * theme/accent preferences apply to the auth pages unchanged.
 */

import type { ReactNode } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { FobMark } from '@/components/fob-mark';

const easeOutSoft = [0.22, 1, 0.36, 1] as const;

export function AuthBrandLockup() {
  const uiText = useTranslation(messages).t;
  return (
    <div className="flex flex-col items-center gap-2.5 text-center">
      <div className="flex items-center gap-2.5">
        <FobMark />
        <span className="text-[17px] font-semibold tracking-[-0.01em] text-[var(--ink)]">Fob</span>
      </div>
      <p className="text-[12px] text-[var(--muted-strong)]">
        {uiText('knowledgeTagline')}
      </p>
    </div>
  );
}

export function AuthScene({
  children,
  width = 400,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  width?: number;
  'aria-label'?: string;
}) {
  return (
    <MotionConfig reducedMotion="never">
      <main
        aria-label={ariaLabel}
        className="relative h-full min-h-full overflow-y-auto bg-[var(--shell)]"
      >
        {/* Quiet stage: one soft accent glow above the card, a faint dot grid below. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[340px]"
          style={{
            background:
              'radial-gradient(420px 260px at 50% -60px, color-mix(in srgb, var(--accent) 13%, transparent), transparent 72%)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.5]"
          style={{
            backgroundImage:
              'radial-gradient(color-mix(in srgb, var(--ink) 7%, transparent) 1px, transparent 1px)',
            backgroundSize: '22px 22px',
            maskImage:
              'linear-gradient(to bottom, transparent 12%, black 45%, black 70%, transparent 96%)',
            WebkitMaskImage:
              'linear-gradient(to bottom, transparent 12%, black 45%, black 70%, transparent 96%)',
          }}
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: easeOutSoft }}
          className="relative flex min-h-full items-center justify-center px-6 py-10"
        >
          <div style={{ width: `min(${width}px, 100%)` }} className="flex flex-col gap-7">
            <AuthBrandLockup />
            {children}
          </div>
        </motion.div>
      </main>
    </MotionConfig>
  );
}

/** The single card every auth state renders into. */
export function AuthPanel({
  children,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  'aria-label'?: string;
}) {
  return (
    <section
      aria-label={ariaLabel}
      className="overlay-surface w-full rounded-[20px] border border-[var(--line)] bg-[var(--panel)] px-7 pb-7 pt-8"
    >
      {children}
    </section>
  );
}

export function AuthPanelHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="mb-5">
      <h1 className="text-[19px] font-semibold leading-7 tracking-[-0.01em] text-[var(--ink)]">
        {title}
      </h1>
      {description ? (
        <p className="mt-1 text-[12px] leading-5 text-[var(--muted-strong)]">{description}</p>
      ) : null}
    </header>
  );
}

export function AuthFootnote({ children }: { children: ReactNode }) {
  return <p className="text-center text-[11px] leading-5 text-[var(--muted)]">{children}</p>;
}

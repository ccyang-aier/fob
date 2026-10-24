'use client';
import { useTranslation } from '@/lib/i18n/react';
import { loadingMessages } from './i18n/auth-loading.messages';

export function AuthLoading({ stage }: { stage: 'entry' | 'verify' | 'callback' }) {
  const { t } = useTranslation(loadingMessages);
  return (
    <main aria-label={t(stage)} className="relative h-full overflow-y-auto bg-[var(--shell)]">
      <div className="flex min-h-full items-center justify-center px-6 py-10">
        <div className="overlay-surface w-full max-w-[420px] rounded-[14px] border border-[var(--line)] bg-[var(--panel)] p-7">
          <p role="status" className="text-[12.5px] text-[var(--muted-strong)]">
            {t(`${stage}Loading`)}
          </p>
        </div>
      </div>
    </main>
  );
}

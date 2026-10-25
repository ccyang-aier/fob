'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/general-settings.messages';

/**
 * 通用设置：语言偏好与当前知识服务的真实连接状态。
 */

import { useEffect, useState } from 'react';
import { Plugs } from '@phosphor-icons/react';

import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { cn } from '@/lib/utils';
import { LanguageSettings } from './language-settings';

export function GeneralSettings() {
  const { t: uiText } = useTranslation(messages);
  const [backendUrl, setBackendUrl] = useState<string>('—');
  const [online, setOnline] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const { origin } = await getFobApiOrigin();
        if (controller.signal.aborted) return;
        setBackendUrl(origin);
        const response = await fetch(origin + '/api/auth/ok', { credentials: 'include', signal: controller.signal });
        if (!controller.signal.aborted) setOnline(response.ok);
      } catch {
        if (!controller.signal.aborted) setOnline(false);
      } finally {
        if (!controller.signal.aborted) setChecking(false);
      }
    })();
    return () => controller.abort();
  }, []);

  return (
    <div className="mx-auto w-full max-w-[960px] px-10 pb-14 pt-11 max-[1100px]:px-7 max-[900px]:pt-7">
      <PanelHeader title={uiText('通用')} />
      <LanguageSettings />
      <section className="mt-5 overflow-hidden rounded-[12px] border border-[var(--line)] bg-panel shadow-[0_1px_2px_rgba(23,25,27,0.04)]">
        <header className="flex items-center gap-2 border-b border-[var(--line)] px-5 py-3.5">
          <Plugs className="size-[15px] text-[var(--muted)]" weight="regular" aria-hidden />
          <h2 className="text-[13px] font-medium">{uiText('运行状态')}</h2>
        </header>
        <dl className="px-5 py-2">
          <StatusRow label={uiText('后端服务')}>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 font-medium',
                online ? 'text-ok' : 'text-warn',
              )}
            >
              <span
                className={cn(
                  'size-1.5 rounded-full',
                  online ? 'bg-[var(--ok-ink)]' : 'bg-[var(--warn-ink)] animate-pulse',
                )}
                aria-hidden
              />
              {checking ? uiText('连接中…') : online ? uiText('在线') : uiText('无法连接')}
            </span>
          </StatusRow>
          <StatusRow label={uiText('服务地址')} last>
            <span className="code-scope text-[var(--ink-soft)]">{backendUrl}</span>
          </StatusRow>
        </dl>
      </section>
    </div>
  );
}

function StatusRow({
  label,
  last,
  children,
}: {
  label: string;
  last?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-4 py-2.5 text-[12px]',
        !last && 'border-b border-[var(--line)]',
      )}
    >
      <dt className="shrink-0 text-[var(--muted-strong)]">{label}</dt>
      <dd className="min-w-0 truncate text-[var(--ink)]">{children}</dd>
    </div>
  );
}

export function PanelHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header>
      <h2 className="text-[16px] font-semibold tracking-[-0.01em]">{title}</h2>
      {description && <p className="mt-0.5 text-[12px] text-[var(--muted)]">{description}</p>}
    </header>
  );
}

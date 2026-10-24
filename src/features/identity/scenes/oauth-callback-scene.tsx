'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/oauth-callback-scene.messages';

/**
 * `/auth/callback` — OAuth/SSO landing (A04). Failures arrive as
 * `?error=<code>` (fixed codes; descriptions are dropped), completions as
 * `?status=ok`. Because the IdP round-trip leaves the document, the page
 * re-validates the session on load (`GET /api/auth/get-session`) before
 * restoring the saved `returnTo` target — the "re-check after reload" rule
 * applied to the SSO path.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowClockwise, CircleNotch, SignIn } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { oauthCallbackErrorCopy, parseOAuthCallbackQuery } from '../oauth-callback';
import { consumeAuthReturnTo } from '../return-to';
import { authEntryPath } from '../session';
import { useIdentity } from '../identity-provider';
import { authErrorCopyFor } from '../auth-errors';
import type { FobAuthUser } from '../auth-api';
import { AuthPanel, AuthPanelHeading, AuthScene } from '../components/auth-scene';
import { AppAlert } from '@/components/app-alert';

type CompletionState =
  | { phase: 'checking' }
  | { phase: 'authenticated'; user: FobAuthUser }
  | { phase: 'missing' }
  | { phase: 'check-failed'; cause: unknown };

export function OAuthCallbackScene() {
  const { t: uiText, locale } = useTranslation(messages);
  const router = useRouter();
  const { refresh, completeSignIn } = useIdentity();
  const params = useSearchParams();
  const view = useMemo(() => parseOAuthCallbackQuery(params.toString()), [params]);
  const [completion, setCompletion] = useState<CompletionState>({ phase: 'checking' });
  const redirecting = useRef(false);

  useEffect(() => {
    if (view.kind !== 'completed') return;
    let active = true;
    refresh().then(
      (value) => {
        if (active)
          setCompletion(
            value.status === 'authenticated'
              ? { phase: 'authenticated', user: value.user }
              : { phase: 'missing' },
          );
      },
      (cause) => {
        if (active) setCompletion({ phase: 'check-failed', cause });
      },
    );
    return () => {
      active = false;
    };
  }, [view.kind, refresh]);

  // Brief confirmation beat, then restore the saved target.
  useEffect(() => {
    if (completion.phase !== 'authenticated' || redirecting.current) return;
    redirecting.current = true;
    const target = typeof window === 'undefined' ? '/' : consumeAuthReturnTo(window.sessionStorage);
    const timer = window.setTimeout(() => {
      void completeSignIn()
        .then(() => router.replace(target))
        .catch((cause) => setCompletion({ phase: 'check-failed', cause }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, [completion, router, completeSignIn]);

  function retryCheck() {
    setCompletion({ phase: 'checking' });
    refresh().then(
      (value) =>
        setCompletion(
          value.status === 'authenticated'
            ? { phase: 'authenticated', user: value.user }
            : { phase: 'missing' },
        ),
      (cause) => setCompletion({ phase: 'check-failed', cause }),
    );
  }

  if (view.kind === 'error') {
    const copy = oauthCallbackErrorCopy(view.code, locale);
    return (
      <AuthScene aria-label={uiText('企业登录结果')} width={420}>
        <AuthPanel>
          <AuthPanelHeading title={uiText('企业登录')} />
          <AppAlert tone="error" title={copy.title} description={copy.description} />
          <div className="mt-5 flex items-center gap-2">
            <Button type="button" onClick={() => router.push(authEntryPath)}>
              <ArrowClockwise className="size-4" aria-hidden />
              {uiText('重新登录')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => router.push('/')}>
              {uiText('返回首页')}
            </Button>
          </div>
          {copy.recoverable === 'retry' ? (
            <p className="mt-3 text-[11px] leading-5 text-[var(--muted)]">
              {uiText('重新登录后会保留你之前的目标页面。')}
            </p>
          ) : null}
        </AuthPanel>
      </AuthScene>
    );
  }

  if (view.kind === 'completed') {
    return (
      <AuthScene aria-label={uiText('企业登录完成')} width={400}>
        <AuthPanel>
          {completion.phase === 'checking' ? (
            <div
              className="flex items-center gap-3 py-2 text-[12.5px] text-[var(--muted-strong)]"
              role="status"
            >
              <CircleNotch className="size-4 animate-spin text-[var(--accent-ink)]" aria-hidden />
              {uiText('正在确认登录状态…')}
            </div>
          ) : null}
          {completion.phase === 'authenticated' ? (
            <AppAlert
              tone="success"
              title={uiText('登录成功')}
              description={uiText('正在以 {0} 进入 Fob…', { '0': completion.user.email })}
            />
          ) : null}
          {completion.phase === 'missing' ? (
            <>
              <AppAlert
                tone="warning"
                title={uiText('未能确认登录会话')}
                description={uiText(
                  '回调已完成,但没有读取到有效会话。请重新登录;若持续出现,请联系管理员。',
                )}
              />
              <Button
                type="button"
                className="mt-5 h-9 w-full"
                onClick={() => router.push(authEntryPath)}
              >
                <SignIn className="size-4" weight="bold" aria-hidden />
                {uiText('前往登录')}
              </Button>
            </>
          ) : null}
          {completion.phase === 'check-failed' ? (
            <>
              <AppAlert
                tone="error"
                title={uiText('无法确认登录状态')}
                description={authErrorCopyFor(completion.cause, locale).description}
              />
              <Button type="button" className="mt-5 h-9 w-full" onClick={retryCheck}>
                <ArrowClockwise className="size-4" aria-hidden />
                {uiText('重试')}
              </Button>
            </>
          ) : null}
        </AuthPanel>
      </AuthScene>
    );
  }

  return (
    <AuthScene aria-label={uiText('企业登录指引')} width={400}>
      <AuthPanel>
        <AuthPanelHeading
          title={uiText('企业登录')}
          description={uiText('这一页用于接收企业登录的完成回跳。请从登录页选择企业账号发起登录。')}
        />
        <Button type="button" className="h-9 w-full" onClick={() => router.push(authEntryPath)}>
          <SignIn className="size-4" weight="bold" aria-hidden />
          {uiText('前往登录')}
        </Button>
      </AuthPanel>
    </AuthScene>
  );
}

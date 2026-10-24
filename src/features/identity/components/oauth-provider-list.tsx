'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/oauth-provider-list.messages';

/**
 * Configured SSO entrances (A04). `GET /api/auth/oauth/providers` returns the
 * admin-configured `{id,name,kind}[]` — an entrance list, not a health
 * check. Clicking a provider asks `POST /api/auth/sign-in/social` for the
 * authorization URL and performs a top-level navigation to it (tokens never
 * touch the page); the IdP later returns to `/auth/callback`.
 */

import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, Fingerprint, GithubLogo, GoogleLogo } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { authErrorCopyFor } from '../auth-errors';
import { fobAuthApi, type FobOAuthProvider } from '../auth-api';
import { AppAlert } from '@/components/app-alert';
import styles from './auth-form.module.css';

type ProvidersState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; providers: FobOAuthProvider[] };

export function OAuthProviderSection({
  onBeforeNavigate,
  api = fobAuthApi,
}: {
  /** Persists the post-login target before the top-level jump to the IdP. */
  onBeforeNavigate?: () => void;
  api?: typeof fobAuthApi;
}) {
  const uiText = useTranslation(messages).t;
  const [state, setState] = useState<ProvidersState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const seq = ++requestSeq.current;
    api.listOAuthProviders(controller.signal).then(
      (providers) => {
        if (seq === requestSeq.current) setState({ phase: 'ready', providers });
      },
      (cause) => {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        setState({ phase: 'error', message: authErrorCopyFor(cause).description });
      },
    );
    return () => controller.abort();
  }, [api, reloadToken]);

  async function startSignIn(provider: FobOAuthProvider) {
    if (startingId) return;
    setStartError(null);
    setStartingId(provider.id);
    onBeforeNavigate?.();
    try {
      const callbackBase =
        typeof window === 'undefined'
          ? ''
          : new URL('/auth/callback', window.location.origin).origin;
      const callbackURL = `${callbackBase}/auth/callback?status=ok`;
      const errorCallbackURL = `${callbackBase}/auth/callback`;
      const { url } = await api.startSocialSignIn({
        provider: provider.id,
        callbackURL,
        errorCallbackURL,
      });
      window.location.assign(url);
    } catch (cause) {
      setStartingId(null);
      setStartError(authErrorCopyFor(cause).description);
    }
  }

  if (state.phase === 'ready' && state.providers.length === 0) return null;

  return (
    <div
      className={`${styles.providers} flex flex-col gap-3.5`}
      aria-label={uiText('其他登录方式')}
    >
      <div className={styles.divider} aria-hidden>
        {uiText('或')}
      </div>

      {state.phase === 'loading' ? (
        <div
          className={styles.providerGrid}
          aria-busy="true"
          aria-label={uiText('正在加载登录方式')}
        >
          {[0, 1].map((index) => (
            <div
              key={index}
              className="h-10 animate-pulse rounded-[8px] border border-[var(--line)] bg-[var(--surface-subtle)]"
            />
          ))}
        </div>
      ) : null}

      {state.phase === 'error' ? (
        <AppAlert
          tone="error"
          title={uiText('企业登录暂不可用')}
          description={state.message}
          action={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setState({ phase: 'loading' });
                setReloadToken((token) => token + 1);
              }}
            >
              <ArrowClockwise className="size-3.5" aria-hidden />
              {uiText('重试')}
            </Button>
          }
        />
      ) : null}

      {state.phase === 'ready' ? (
        <div className={styles.providerGrid}>
          {state.providers.map((provider) => {
            const starting = startingId === provider.id;
            const ProviderIcon = /google/i.test(provider.id)
              ? GoogleLogo
              : /github/i.test(provider.id)
                ? GithubLogo
                : Fingerprint;
            return (
              <Button
                key={provider.id}
                type="button"
                variant="outline"
                disabled={startingId !== null}
                loading={starting}
                onClick={() => void startSignIn(provider)}
                className={styles.providerButton}
              >
                {!starting ? <ProviderIcon className="size-4 shrink-0" aria-hidden /> : null}
                <span className="min-w-0 truncate">
                  {starting ? uiText('正在跳转…') : provider.name}
                </span>
              </Button>
            );
          })}
        </div>
      ) : null}

      {startError ? <AppAlert tone="error" title={startError} /> : null}
    </div>
  );
}

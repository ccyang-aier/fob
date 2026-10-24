'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-entry-scene.messages';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { resolveAuthReturnTo } from '../return-to';
import { AuthPanel, AuthScene } from '../components/auth-scene';
import { AuthEntryContent } from '../components/auth-entry-content';
import { AppAlert } from '@/components/app-alert';

export function AuthEntryScene() {
  const uiText = useTranslation(messages).t;
  const params = useSearchParams();
  const targetPath = resolveAuthReturnTo(
    params.get('returnTo'),
    typeof window === 'undefined' ? null : window.sessionStorage,
  );
  return (
    <AuthScene aria-label={uiText('Fob 登录')} width={440}>
      <AuthPanel aria-label={uiText('账号登录')}>
        {params.get('reason') === 'expired' ? (
          <AppAlert
            tone="info"
            title={uiText('登录已过期')}
            description={uiText('重新登录后即可继续团队协作。')}
          />
        ) : null}
        <AuthEntryContent
          showBrand={false}
          initialMode={params.get('mode') === 'sign-up' ? 'sign-up' : 'sign-in'}
          targetPath={targetPath}
        />
        <Link
          href="/"
          className="mt-4 block rounded text-center text-xs text-[var(--muted-strong)] hover:text-[var(--accent-ink)]"
        >
          {uiText('先进入工作台')}
        </Link>
      </AuthPanel>
    </AuthScene>
  );
}

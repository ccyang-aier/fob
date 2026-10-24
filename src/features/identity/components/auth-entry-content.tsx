'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-entry-content.messages';

import { useState } from 'react';
import { AuthBrandLockup } from './auth-scene';
import { SignInForm } from './sign-in-form';
import { SignUpForm } from './sign-up-form';
import { OAuthProviderSection } from './oauth-provider-list';
import { saveAuthReturnTo } from '../return-to';
import styles from './auth-form.module.css';

export function AuthEntryContent({
  initialMode = 'sign-in',
  targetPath = '/',
  onSuccess,
  onDismiss,
  showBrand = true,
  currentAccount,
}: {
  showBrand?: boolean;
  initialMode?: 'sign-in' | 'sign-up';
  targetPath?: string;
  onSuccess?: () => void;
  onDismiss?: () => void;
  currentAccount?: string;
}) {
  const uiText = useTranslation(messages).t;
  const [mode, setMode] = useState(initialMode);
  return (
    <div className={styles.entry}>
      {showBrand ? <AuthBrandLockup /> : null}
      <header className={styles.heading}>
        <p className={styles.eyebrow}>
          {currentAccount
            ? uiText('切换账户')
            : mode === 'sign-in'
              ? uiText('登录')
              : uiText('创建账户')}
        </p>
        <h1 className={styles.title}>
          {currentAccount
            ? uiText('切换 ')
            : mode === 'sign-in'
              ? uiText('欢迎回到 ')
              : uiText('加入 ')}
          <span className={styles.wordmark}>Fob</span>
          {currentAccount ? uiText(' 账户') : null}
        </h1>
        <p className={styles.lead}>
          {currentAccount
            ? uiText('当前账户：{0}', { '0': currentAccount })
            : mode === 'sign-in'
              ? uiText('一个账户，连接你的个人工作与团队协作。')
              : uiText('使用邮箱创建账户，验证后即可开始协作。')}
        </p>
      </header>
      <div>
        {mode === 'sign-in' ? (
          <SignInForm
            targetPath={targetPath}
            onSuccess={onSuccess}
            submitLabel={currentAccount ? uiText('切换账户') : uiText('登录')}
          />
        ) : (
          <SignUpForm />
        )}
      </div>
      <OAuthProviderSection
        onBeforeNavigate={() => saveAuthReturnTo(window.sessionStorage, targetPath)}
      />
      <div className={styles.footer}>
        {!currentAccount ? (
          <span>
            {mode === 'sign-in' ? uiText('还没有账户？') : uiText('已有账户？')}
            <button
              type="button"
              onClick={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
              className={`fob-action ${styles.modeButton}`}
            >
              {mode === 'sign-in' ? uiText('创建账户') : uiText('直接登录')}
            </button>
          </span>
        ) : (
          <span />
        )}
        {onDismiss ? (
          <button type="button" onClick={onDismiss} className={`fob-action ${styles.dismiss}`}>
            {currentAccount ? uiText('取消切换') : uiText('暂不登录')}
          </button>
        ) : null}
      </div>
    </div>
  );
}

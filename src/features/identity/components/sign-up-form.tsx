'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/sign-up-form.messages';

/**
 * Registration (A04). The backend accepts sign-up uniformly (anti-
 * enumeration) and never promises email delivery, so the acceptance copy is
 * exactly the A01 wording: 注册请求已受理,请查收验证邮件;未收到可重发。
 */

import { verificationCallbackUrl } from '../verification-url';
import { useState, type FormEvent } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { authErrorCopyFor } from '../auth-errors';
import { fobAuthApi, type FobAuthApi } from '../auth-api';
import { authPendingEmailStorageKey } from '../return-to';
import {
  hasAuthFieldErrors,
  validateSignUpForm,
  authFieldFlags,
  type AuthFieldFlags,
} from '../validation';
import { AuthTextField } from './auth-field';
import { AppAlert } from '@/components/app-alert';
import { ResendVerificationEntry } from './resend-verification';
import styles from './auth-form.module.css';

export function SignUpForm({ api = fobAuthApi }: { api?: FobAuthApi }) {
  const { t: uiText, locale } = useTranslation(messages);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldFlags>({});
  const [bannerError, setBannerError] = useState<{ cause: unknown } | null>(null);
  const banner = bannerError ? authErrorCopyFor(bannerError.cause, locale) : null;
  const currentErrors = validateSignUpForm({ name, email, password }, locale);
  const [submitting, setSubmitting] = useState(false);
  const [acceptedEmail, setAcceptedEmail] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const errors = validateSignUpForm({ name, email, password });
    setFieldErrors(authFieldFlags(errors));
    setBannerError(null);
    if (hasAuthFieldErrors(errors)) return;
    setSubmitting(true);
    try {
      await api.signUpWithEmail({
        name: name.trim(),
        email: email.trim(),
        password,
        callbackURL: verificationCallbackUrl(),
      });
      try {
        window.sessionStorage.setItem(authPendingEmailStorageKey, email.trim().toLowerCase());
      } catch {
        // Resend also accepts manual input; storage is a convenience only.
      }
      setAcceptedEmail(email.trim());
    } catch (cause) {
      setBannerError({ cause });
    } finally {
      setSubmitting(false);
    }
  }

  if (acceptedEmail !== null) {
    return (
      <div className="flex flex-col gap-4">
        <AppAlert
          tone="success"
          title={uiText('注册请求已受理')}
          description={uiText('请查收验证邮件;未收到可重发。')}
        />
        <ResendVerificationEntry initialEmail={acceptedEmail} />
        <p className="text-[11px] leading-5 text-[var(--muted)]">
          {uiText('验证邮件中的链接 1 小时内有效;完成验证后即可使用邮箱登录。')}
        </p>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className={styles.form} aria-label={uiText('注册账号')}>
      <AuthTextField
        label={uiText('名称')}
        autoComplete="name"
        placeholder={uiText('你的名称')}
        value={name}
        onChange={(value) => {
          setName(value);
          setFieldErrors((current) => ({ ...current, name: undefined }));
        }}
        error={fieldErrors.name ? (currentErrors.name ?? null) : null}
        disabled={submitting}
        maxLength={121}
        autoFocus
      />
      <AuthTextField
        label={uiText('邮箱')}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="name@example.com"
        value={email}
        onChange={(value) => {
          setEmail(value);
          setFieldErrors((current) => ({ ...current, email: undefined }));
        }}
        error={fieldErrors.email ? (currentErrors.email ?? null) : null}
        disabled={submitting}
      />
      <AuthTextField
        label={uiText('密码')}
        type="password"
        autoComplete="new-password"
        placeholder={uiText('设置登录密码')}
        value={password}
        onChange={(value) => {
          setPassword(value);
          setFieldErrors((current) => ({ ...current, password: undefined }));
        }}
        error={fieldErrors.password ? (currentErrors.password ?? null) : null}
        hint={uiText('12–128 位,建议混合字母、数字与符号')}
        disabled={submitting}
      />
      {banner ? (
        <AppAlert tone="error" title={banner.title} description={banner.description} />
      ) : null}
      <Button type="submit" loading={submitting} className={styles.submit}>
        {!submitting ? <PaperPlaneTilt className="size-4" weight="regular" aria-hidden /> : null}
        {submitting ? uiText('正在提交…') : uiText('创建账号')}
      </Button>
    </form>
  );
}

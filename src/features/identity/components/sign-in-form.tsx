'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/sign-in-form.messages';

/**
 * Email/password sign-in (A04). Client validation gates obvious input errors;
 * server failures normalize to the domain error whose fixed copy never
 * distinguishes "unknown user" from "wrong password". `EMAIL_NOT_VERIFIED`
 * switches to a resend sub-state instead of a plain error.
 */

import { useState, type FormEvent } from 'react';
import { useIdentity } from '../identity-provider';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { authErrorCopyFor, isFobAuthFlowError } from '../auth-errors';
import { fobAuthApi, type FobAuthApi } from '../auth-api';
import {
  hasAuthFieldErrors,
  validateSignInForm,
  authFieldFlags,
  type AuthFieldFlags,
} from '../validation';
import { AuthTextField } from './auth-field';
import { AppAlert } from '@/components/app-alert';
import { ResendVerificationEntry } from './resend-verification';
import styles from './auth-form.module.css';

export function SignInForm({
  targetPath,
  onSuccess,
  submitLabel,
  api = fobAuthApi,
}: {
  targetPath: string;
  onSuccess?: () => void;
  submitLabel?: string;
  api?: FobAuthApi;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  const router = useRouter();
  const identity = useIdentity();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<AuthFieldFlags>({});
  const [bannerError, setBannerError] = useState<{ cause: unknown } | null>(null);
  const banner = bannerError ? authErrorCopyFor(bannerError.cause, locale) : null;
  const currentErrors = validateSignInForm({ email, password }, locale);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const errors = validateSignInForm({ email, password });
    setFieldErrors(authFieldFlags(errors));
    setBannerError(null);
    if (hasAuthFieldErrors(errors)) return;
    setSubmitting(true);
    try {
      await api.signInWithPassword({ email: email.trim(), password });
      await identity.completeSignIn();
      if (onSuccess) onSuccess();
      else router.replace(targetPath);
    } catch (cause) {
      setSubmitting(false);
      if (isFobAuthFlowError(cause) && cause.code === 'EMAIL_NOT_VERIFIED') {
        setUnverifiedEmail(email.trim());
        return;
      }
      setBannerError({ cause });
    }
  }

  if (unverifiedEmail !== null) {
    return (
      <div className="flex flex-col gap-4">
        <AppAlert
          tone="warning"
          title={uiText('邮箱尚未验证')}
          description={uiText(
            '该邮箱已注册但尚未完成验证。请查收验证邮件并打开其中的链接;未收到可重新发送。',
          )}
        />
        <ResendVerificationEntry initialEmail={unverifiedEmail} />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          onClick={() => {
            setUnverifiedEmail(null);
            setPassword('');
          }}
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {uiText('返回登录')}
        </Button>
      </div>
    );
  }

  return (
    <form noValidate onSubmit={submit} className={styles.form} aria-label={uiText('邮箱登录')}>
      <AuthTextField
        label={uiText('邮箱')}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="name@company.com"
        value={email}
        onChange={(value) => {
          setEmail(value);
          setFieldErrors((current) => ({ ...current, email: undefined }));
        }}
        error={fieldErrors.email ? (currentErrors.email ?? null) : null}
        disabled={submitting}
        autoFocus
      />
      <AuthTextField
        label={uiText('密码')}
        type="password"
        autoComplete="current-password"
        placeholder={uiText('输入你的密码')}
        value={password}
        onChange={(value) => {
          setPassword(value);
          setFieldErrors((current) => ({ ...current, password: undefined }));
        }}
        error={fieldErrors.password ? (currentErrors.password ?? null) : null}
        disabled={submitting}
      />
      {banner ? (
        <AppAlert tone="error" title={banner.title} description={banner.description} />
      ) : null}
      <Button type="submit" loading={submitting} className={styles.submit}>
        {submitting ? uiText('正在登录…') : (submitLabel ?? uiText('登录'))}
        {!submitting ? <ArrowRight size={15} data-arrow aria-hidden /> : null}
      </Button>
    </form>
  );
}

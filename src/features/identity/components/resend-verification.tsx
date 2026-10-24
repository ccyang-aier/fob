'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/resend-verification.messages';

/**
 * Verification-email resend entry (A04). Shared by the sign-up acceptance
 * state, the `EMAIL_NOT_VERIFIED` sign-in error and the verify-email landing.
 * A 60-second client cooldown keeps honest users under the backend's 5/min
 * resend limit; a server 429 still renders the fixed boundary copy. Sending
 * is always "accepted" — the API is anti-enumeration and never promises
 * delivery for unknown or already-verified addresses.
 */

import { verificationCallbackUrl } from '../verification-url';
import { useEffect, useMemo, useState } from 'react';
import { PaperPlaneTilt } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { authErrorCopyFor, isFobAuthFlowError } from '../auth-errors';
import { fobAuthApi, type FobAuthApi } from '../auth-api';
import {
  isResendAvailable,
  resendCooldownRemaining,
  startResendCooldown,
  type ResendCooldownState,
} from '../resend-cooldown';
import { AuthTextField } from './auth-field';
import { AppAlert } from '@/components/app-alert';

export function ResendVerificationEntry({
  initialEmail = '',
  compact = false,
  api = fobAuthApi,
}: {
  initialEmail?: string;
  /** Compact renders without the bordered box (embedded in another panel). */
  compact?: boolean;
  api?: FobAuthApi;
}) {
  const { t: uiText, locale } = useTranslation(messages);
  const [email, setEmail] = useState(initialEmail);
  const [emailError, setEmailError] = useState(false);
  const [cooldown, setCooldown] = useState<ResendCooldownState>(null);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);
  const [outcome, setOutcome] = useState<
    { kind: 'success' } | { kind: 'error'; cause: unknown } | null
  >(null);
  const outcomeCopy =
    outcome?.kind === 'success'
      ? {
          tone: 'success' as const,
          title: uiText('发送请求已受理'),
          description: uiText(
            '如该邮箱已注册且尚未验证,将收到新的验证邮件;未收到请稍后再试或检查垃圾箱。',
          ),
        }
      : outcome?.kind === 'error'
        ? {
            ...authErrorCopyFor(outcome.cause, locale),
            tone:
              isFobAuthFlowError(outcome.cause) && outcome.cause.code === 'RATE_LIMITED'
                ? ('warning' as const)
                : ('error' as const),
          }
        : null;

  useEffect(() => {
    if (cooldown === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [cooldown]);

  const remainingSeconds = useMemo(() => resendCooldownRemaining(cooldown, now), [cooldown, now]);

  async function resend() {
    if (sending || (cooldown !== null && !isResendAvailable(cooldown, Date.now()))) return;
    const candidate = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
      setEmailError(true);
      return;
    }
    setEmailError(false);
    setSending(true);
    setOutcome(null);
    try {
      await api.sendVerificationEmail({ email: candidate, callbackURL: verificationCallbackUrl() });
      setOutcome({ kind: 'success' });
      setCooldown(startResendCooldown());
    } catch (cause) {
      setOutcome({ kind: 'error', cause });
    } finally {
      setSending(false);
    }
  }

  const body = (
    <div className="flex flex-col gap-3">
      <AuthTextField
        label={uiText('邮箱地址')}
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="name@example.com"
        value={email}
        onChange={(value) => setEmail(value)}
        error={emailError ? uiText('请输入邮箱地址') : null}
        disabled={sending}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 self-start"
        loading={sending}
        disabled={remainingSeconds > 0}
        onClick={() => void resend()}
      >
        {!sending ? <PaperPlaneTilt className="size-3.5" weight="fill" aria-hidden /> : null}
        {remainingSeconds > 0
          ? uiText('重新发送({0}s)', { '0': remainingSeconds })
          : uiText('重新发送验证邮件')}
      </Button>
      {outcomeCopy ? (
        <AppAlert
          tone={outcomeCopy.tone}
          title={outcomeCopy.title}
          description={outcomeCopy.description}
        />
      ) : null}
    </div>
  );

  if (compact) return body;
  return (
    <div className="rounded-[10px] border border-[var(--line)] bg-[var(--surface-subtle)] p-4">
      {body}
    </div>
  );
}

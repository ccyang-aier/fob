import { getLocale, type Locale } from '@/lib/i18n/locale';

import { createTranslator } from '@/lib/i18n/messages';
import { messages } from './i18n/verify-callback.messages';

/**
 * Email verification landing parsing (A04).
 *
 * The verification email links to the API's `/api/auth/verify-email`, which
 * redirects (Better Auth 1.7.6) to the `callbackURL` we attach when signing
 * up / resending: success goes to that URL as-is (`/auth/verify?status=ok`),
 * failures arrive as `/auth/verify?error=<code>` (the backend appends its
 * `error` to our callback URL). A bare `/auth/verify` is a manual visit.
 */

import { authPendingEmailStorageKey } from './return-to';

export type VerifyEmailView =
  { kind: 'verified' } | { kind: 'error'; code: VerifyEmailErrorCode } | { kind: 'manual' };

export type VerifyEmailErrorCode =
  'TOKEN_EXPIRED' | 'INVALID_TOKEN' | 'USER_NOT_FOUND' | 'INVALID_USER';

const errorCodes: ReadonlySet<string> = new Set([
  'TOKEN_EXPIRED',
  'INVALID_TOKEN',
  'USER_NOT_FOUND',
  'INVALID_USER',
]);

export function parseVerifyEmailQuery(search: string | URLSearchParams): VerifyEmailView {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const error = params.get('error');
  if (error !== null && error !== '') {
    // The error param outranks the status param: the backend appends it to a
    // callback URL that already carries `?status=ok`.
    const code = errorCodes.has(error) ? (error as VerifyEmailErrorCode) : 'INVALID_TOKEN';
    return { kind: 'error', code };
  }
  if (params.get('status') === 'ok' || params.get('status') === 'verified')
    return { kind: 'verified' };
  return { kind: 'manual' };
}

export type VerifyEmailErrorCopy = {
  title: string;
  description: string;
  /** Expired links can be recovered by resending; the rest need a new attempt or support. */
  resend: boolean;
};

function getVerificationCopies(locale: Locale): Record<VerifyEmailErrorCode, VerifyEmailErrorCopy> {
  const uiText = createTranslator(messages, locale);
  return {
    TOKEN_EXPIRED: {
      title: uiText('验证链接已过期'),
      description: uiText('验证链接在 1 小时后失效。可以重新发送验证邮件,再打开新链接完成验证。'),
      resend: true,
    },
    INVALID_TOKEN: {
      title: uiText('验证链接无效'),
      description: uiText('链接可能已被使用过或不是最新的。若尚未验证,可重新发送验证邮件。'),
      resend: true,
    },
    USER_NOT_FOUND: {
      title: uiText('未找到对应账号'),
      description: uiText('这个链接对应的账号不存在,可能已被删除。请重新注册或联系管理员。'),
      resend: false,
    },
    INVALID_USER: {
      title: uiText('账号状态校验未通过'),
      description: uiText('链接与当前账号不匹配,无法完成验证;请重新发送或联系管理员。'),
      resend: false,
    },
  };
}

export function verifyEmailErrorCopy(
  code: VerifyEmailErrorCode,
  locale: Locale = getLocale(),
): VerifyEmailErrorCopy {
  return getVerificationCopies(locale)[code];
}

/** Where the resend entry preloads its email from (sessionStorage draft). */
export const verifyPendingEmailStorageKey = authPendingEmailStorageKey;

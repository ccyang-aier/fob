import { getLocale, type Locale } from '@/lib/i18n/locale';

import { createTranslator } from '@/lib/i18n/messages';
import { messages } from './i18n/oauth-callback.messages';

/**
 * OAuth/SSO callback parsing (A04).
 *
 * After `POST /api/auth/sign-in/social` the browser returns to the app with a
 * top-level redirect from Better Auth: success goes to the exact
 * `callbackURL` we provided (`/auth/callback?status=ok`), failures to
 * `errorCallbackURL` (`/auth/callback`) with `?error=<code>` — codes fixed by
 * the backend contract (Fob sanitization + Better Auth 1.7.6 core). The
 * `error_description` query, when present, is deliberately dropped: UI copy
 * is keyed by code only, so external provider text never reaches the screen.
 */

export type OAuthCallbackView =
  { kind: 'completed' } | { kind: 'error'; code: string } | { kind: 'manual' };

const knownErrorCodes = new Set([
  'access_denied',
  'oauth_provider_error',
  'invalid_callback_request',
  'state_not_found',
  'state_mismatch',
  'state_invalid',
  'state_security_mismatch',
  'no_code',
  'oauth_provider_not_found',
  'issuer_mismatch',
  'nonce_binding_missing',
  'invalid_code',
  'unable_to_get_user_info',
  'no_callback_url',
  'unable_to_link_account',
  'email_does_not_match',
  'account_already_linked_to_different_user',
  'email_not_found',
  'email_not_verified',
  'oauth_identity_rejected',
  'oauth_session_changed',
  'internal_server_error',
]);

export function parseOAuthCallbackQuery(search: string | URLSearchParams): OAuthCallbackView {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const error = params.get('error');
  if (error !== null && error !== '') {
    const code = knownErrorCodes.has(error) ? error : 'oauth_provider_error';
    return { kind: 'error', code };
  }
  if (params.get('status') === 'ok') return { kind: 'completed' };
  return { kind: 'manual' };
}

export type OAuthCallbackErrorCopy = {
  title: string;
  description: string;
  /** Whether starting a fresh sign-in can plausibly fix this failure. */
  recoverable: 'retry' | 'switch-way' | 'support';
};

function getOAuthCopies(locale: Locale): Record<string, OAuthCallbackErrorCopy> {
  const uiText = createTranslator(messages, locale);
  return {
    access_denied: {
      title: uiText('已取消企业登录'),
      description: uiText('你在身份提供方拒绝了授权,可随时重新发起登录。'),
      recoverable: 'retry',
    },
    oauth_provider_error: {
      title: uiText('身份提供方返回错误'),
      description: uiText('企业登录服务暂时异常,请稍后重试;若持续失败请联系管理员。'),
      recoverable: 'retry',
    },
    state_not_found: {
      title: uiText('登录流程已失效'),
      description: uiText('本次登录缺少状态凭据,可能已超时,请重新发起登录。'),
      recoverable: 'retry',
    },
    state_mismatch: {
      title: uiText('登录状态校验未通过'),
      description: uiText('本次登录的状态凭据无效或已过期(10 分钟内有效),请重新发起。'),
      recoverable: 'retry',
    },
    state_invalid: {
      title: uiText('登录状态无效'),
      description: uiText('本次登录的状态凭据无法解析,请重新发起登录。'),
      recoverable: 'retry',
    },
    state_security_mismatch: {
      title: uiText('登录状态校验未通过'),
      description: uiText('本次登录的状态凭据不匹配,请重新发起登录。'),
      recoverable: 'retry',
    },
    invalid_callback_request: {
      title: uiText('回调请求无效'),
      description: uiText('身份提供方返回的数据无法识别,请重新发起登录。'),
      recoverable: 'retry',
    },
    no_code: {
      title: uiText('未收到授权结果'),
      description: uiText('身份提供方没有返回授权码,请重新发起登录。'),
      recoverable: 'retry',
    },
    oauth_provider_not_found: {
      title: uiText('登录入口不存在'),
      description: uiText('该企业登录入口已下线或配置变更,请返回重新选择登录方式。'),
      recoverable: 'switch-way',
    },
    issuer_mismatch: {
      title: uiText('身份提供方校验未通过'),
      description: uiText('回调的签发方与配置不一致,登录已中止;请联系管理员核对配置。'),
      recoverable: 'support',
    },
    nonce_binding_missing: {
      title: uiText('安全校验缺失'),
      description: uiText('本次登录缺少必需的 nonce 绑定,请重新发起;若持续出现请联系管理员。'),
      recoverable: 'retry',
    },
    invalid_code: {
      title: uiText('授权码已失效'),
      description: uiText('授权码一次性使用且有效期很短,请重新发起登录。'),
      recoverable: 'retry',
    },
    unable_to_get_user_info: {
      title: uiText('无法读取账号信息'),
      description: uiText('身份提供方未返回可用的账号资料,请重试;若持续出现请联系管理员。'),
      recoverable: 'retry',
    },
    no_callback_url: {
      title: uiText('登录流程中断'),
      description: uiText('登录会话缺少回跳目标,请重新发起登录。'),
      recoverable: 'retry',
    },
    unable_to_link_account: {
      title: uiText('账号关联失败'),
      description: uiText('本次关联未能完成,请重新发起;若持续出现请联系管理员。'),
      recoverable: 'retry',
    },
    email_does_not_match: {
      title: uiText('邮箱不一致'),
      description: uiText('该外部账号的邮箱与当前账号不匹配,关联已拒绝。'),
      recoverable: 'switch-way',
    },
    account_already_linked_to_different_user: {
      title: uiText('账号已被其他用户占用'),
      description: uiText('此外部账号已关联到另一位用户,请改用对应的登录方式。'),
      recoverable: 'switch-way',
    },
    email_not_found: {
      title: uiText('未获取到邮箱'),
      description: uiText('身份提供方没有返回邮箱地址,无法完成登录;请联系管理员检查配置。'),
      recoverable: 'support',
    },
    email_not_verified: {
      title: uiText('邮箱未在提供方验证'),
      description: uiText('请先在身份提供方完成邮箱验证,再回来登录。'),
      recoverable: 'switch-way',
    },
    oauth_identity_rejected: {
      title: uiText('身份不被接受'),
      description: uiText('该账号的邮箱未验证或不在允许的域名范围内,请联系管理员。'),
      recoverable: 'support',
    },
    oauth_session_changed: {
      title: uiText('会话已变化'),
      description: uiText('发起登录时的会话与当前不一致,请重新发起登录。'),
      recoverable: 'retry',
    },
    internal_server_error: {
      title: uiText('登录服务内部错误'),
      description: uiText('处理登录时发生服务端错误,请稍后重试;若持续出现请联系管理员。'),
      recoverable: 'retry',
    },
  };
}

function getOAuthFallback(locale: Locale): OAuthCallbackErrorCopy {
  const uiText = createTranslator(messages, locale);
  return {
    title: uiText('登录未能完成'),
    description: uiText('发生未预期的错误,请重新发起登录;若持续出现请联系管理员。'),
    recoverable: 'retry',
  };
}

export function oauthCallbackErrorCopy(
  code: string,
  locale: Locale = getLocale(),
): OAuthCallbackErrorCopy {
  return getOAuthCopies(locale)[code] ?? getOAuthFallback(locale);
}

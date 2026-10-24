import { getLocale, type Locale } from '@/lib/i18n/locale';

import { createTranslator } from '@/lib/i18n/messages';
import { messages } from './i18n/auth-errors.messages';

/**
 * Global Fob identity error boundary.
 *
 * The auth API is plain Better Auth HTTP (not tRPC): failures arrive as
 * `{ code?, message? }` JSON bodies with a status, or as transport failures.
 * Everything normalizes here into one domain error so auth UI branches on a
 * stable `code` instead of sniffing response internals. The Fob backend
 * contract (`backend/server/src/platform/identity/README.md`) guarantees sanitized
 * codes/messages; unknown codes degrade instead of leaking internals.
 */

export type FobAuthErrorCode =
  | 'SESSION_NOT_PERSISTED'
  | 'INVALID_CREDENTIALS'
  | 'EMAIL_NOT_VERIFIED'
  | 'EMAIL_DELIVERY_FAILED'
  | 'AUTH_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'NETWORK'
  | 'ENDPOINT'
  | 'INVALID_REQUEST';

/** Only transient conditions retry; credential and request errors surface immediately. */
const retryableCodes: ReadonlySet<FobAuthErrorCode> = new Set([
  'EMAIL_DELIVERY_FAILED',
  'AUTH_UNAVAILABLE',
  'RATE_LIMITED',
  'NETWORK',
]);

export class FobAuthFlowError extends Error {
  readonly code: FobAuthErrorCode;
  readonly httpStatus: number | null;
  readonly serverCode: string | null;

  constructor(
    code: FobAuthErrorCode,
    options: {
      message?: string;
      httpStatus?: number | null;
      serverCode?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? defaultAuthErrorMessage(code), { cause: options.cause });
    this.name = 'FobAuthFlowError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.serverCode = options.serverCode ?? null;
  }
}

export function isFobAuthFlowError(error: unknown): error is FobAuthFlowError {
  return error instanceof FobAuthFlowError;
}

export function isRetryableAuthError(error: unknown): boolean {
  return isFobAuthFlowError(error) && retryableCodes.has(error.code);
}

/**
 * Every sanitized code the auth seam can emit, mapped to its domain meaning.
 * Server messages stay English diagnostics; the UI renders its own Chinese
 * copy via `authErrorCopy` and never echoes the server text to the user.
 */
const domainByServerCode: Record<string, FobAuthErrorCode> = {
  // Better Auth 1.7.6 email-password seam; sign-in never distinguishes
  // "user not found" from "wrong password" (A01 anti-enumeration).
  INVALID_EMAIL_OR_PASSWORD: 'INVALID_CREDENTIALS',
  INVALID_PASSWORD: 'INVALID_CREDENTIALS',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  // Fob http.ts sanitizes unknown 5xx to AUTH_UNAVAILABLE.
  AUTH_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  OAUTH_PROVIDER_UNAVAILABLE: 'AUTH_UNAVAILABLE',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'INVALID_REQUEST',
  FAILED_TO_CREATE_USER: 'INVALID_REQUEST',
  FAILED_TO_CREATE_SESSION: 'INVALID_REQUEST',
  INVALID_NAME: 'INVALID_REQUEST',
  INVALID_EMAIL: 'INVALID_REQUEST',
  INVALID_TOKEN: 'INVALID_REQUEST',
  TOKEN_EXPIRED: 'INVALID_REQUEST',
  EMAIL_ALREADY_VERIFIED: 'INVALID_REQUEST',
  EMAIL_MISMATCH: 'INVALID_REQUEST',
  VERIFICATION_EMAIL_NOT_ENABLED: 'INVALID_REQUEST',
  INVALID_ORIGIN: 'INVALID_REQUEST',
  INVALID_CONTENT_TYPE: 'INVALID_REQUEST',
  PAYLOAD_TOO_LARGE: 'INVALID_REQUEST',
  INVALID_CALLBACK_URL: 'INVALID_REQUEST',
  INVALID_OAUTH_REQUEST: 'INVALID_REQUEST',
  PROVIDER_NOT_FOUND: 'INVALID_REQUEST',
};

function domainForStatus(status: number): FobAuthErrorCode {
  if (status === 401) return 'INVALID_CREDENTIALS';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 404) return 'AUTH_UNAVAILABLE';
  if (status >= 500) return 'AUTH_UNAVAILABLE';
  return 'INVALID_REQUEST';
}

export function authFlowErrorFromResponse(status: number, body: unknown): FobAuthFlowError {
  const serverCode =
    typeof (body as { code?: unknown } | null)?.code === 'string'
      ? (body as { code: string }).code
      : null;
  const code =
    serverCode && domainByServerCode[serverCode]
      ? domainByServerCode[serverCode]
      : domainForStatus(status);
  return new FobAuthFlowError(code, { httpStatus: status, serverCode });
}

/** Normalizes any failure below this layer (transport, endpoint, unknown shapes). */
export function normalizeAuthFlowError(cause: unknown): FobAuthFlowError {
  if (cause instanceof FobAuthFlowError) return cause;
  const message = cause instanceof Error ? cause.message : undefined;
  // Endpoint resolution failures from the data layer carry their own shape.
  const endpointCode = (cause as { code?: unknown } | null)?.code;
  if (endpointCode === 'ENDPOINT') return new FobAuthFlowError('ENDPOINT', { cause });
  return new FobAuthFlowError('NETWORK', { message, cause });
}

const defaultMessages: Record<FobAuthErrorCode, string> = {
  SESSION_NOT_PERSISTED: 'The browser did not retain the session cookie.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  EMAIL_NOT_VERIFIED: 'This email address has not been verified yet.',
  EMAIL_DELIVERY_FAILED: 'The verification email could not be sent.',
  AUTH_UNAVAILABLE: 'The authentication service is unavailable.',
  RATE_LIMITED: 'Too many attempts.',
  NETWORK: 'The authentication service could not be reached.',
  ENDPOINT: 'The authentication endpoint is not configured.',
  INVALID_REQUEST: 'The request could not be completed.',
};

function defaultAuthErrorMessage(code: FobAuthErrorCode): string {
  return defaultMessages[code];
}

export type AuthErrorCopy = { title: string; description: string };

/** Fixed Chinese copy per domain code; never built from server-provided text. */
function getAuthCopies(locale: Locale): Record<FobAuthErrorCode, AuthErrorCopy> {
  const uiText = createTranslator(messages, locale);
  return {
    SESSION_NOT_PERSISTED: {
      title: uiText('登录会话未能保存'),
      description: uiText('浏览器没有保存会话，请检查 Cookie 设置后重试。'),
    },
    INVALID_CREDENTIALS: {
      title: uiText('邮箱或密码不正确'),
      description: uiText('请检查后重试;若刚注册,请先完成邮箱验证再登录。'),
    },
    EMAIL_NOT_VERIFIED: {
      title: uiText('邮箱尚未验证'),
      description: uiText('该邮箱已注册但尚未完成验证,请查收验证邮件后再登录。'),
    },
    EMAIL_DELIVERY_FAILED: {
      title: uiText('验证邮件暂时未能发送'),
      description: uiText('邮件通道暂时不可用,稍后可以在此重新发送。'),
    },
    AUTH_UNAVAILABLE: {
      title: uiText('认证服务暂时不可用'),
      description: uiText('请稍后重试;若持续出现,请联系管理员。'),
    },
    RATE_LIMITED: {
      title: uiText('操作过于频繁'),
      description: uiText('为保障账号安全,请等待约一分钟后再试。'),
    },
    NETWORK: {
      title: uiText('无法连接认证服务'),
      description: uiText('请检查网络连接后重试。'),
    },
    ENDPOINT: {
      title: uiText('认证服务地址未配置'),
      description: uiText('当前部署缺少认证服务配置,请联系管理员。'),
    },
    INVALID_REQUEST: {
      title: uiText('请求未能完成'),
      description: uiText('请检查输入后重试;若持续出现,请联系管理员。'),
    },
  };
}

export function authErrorCopyFor(error: unknown, locale: Locale = getLocale()): AuthErrorCopy {
  const code = isFobAuthFlowError(error) ? error.code : 'NETWORK';
  return getAuthCopies(locale)[code];
}

import { getLocale, type Locale } from '@/lib/i18n/locale';
import { createTranslator } from '@/lib/i18n/messages';
import { messages } from './i18n/validation.messages';

/**
 * Auth form validation (A04) — pure functions, mirroring the backend limits
 * in Better Auth 1.7.6 as assembled by A01: password 6–128 characters,
 * user name 1–120 after trim, practical email shape. Field errors are
 * user-facing Chinese strings so panels stay free of branching logic.
 */

export type AuthFieldErrors = Partial<Record<'name' | 'email' | 'password', string>>;

export const authPasswordMinLength = 6;
export const authPasswordMaxLength = 128;
export const authNameMaxLength = 120;

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAuthEmail(raw: string, locale: Locale = getLocale()): string | null {
  const uiText = createTranslator(messages, locale);
  const email = raw.trim();
  if (!email) return uiText('请输入邮箱地址');
  if (email.length > 320) return uiText('邮箱地址过长');
  if (!emailPattern.test(email)) return uiText('邮箱地址格式不正确');
  return null;
}

export function validateAuthPassword(raw: string, locale: Locale = getLocale()): string | null {
  const uiText = createTranslator(messages, locale);
  if (!raw) return uiText('请输入密码');
  if (raw.length < authPasswordMinLength)
    return uiText('密码至少 {0} 位', { '0': authPasswordMinLength });
  if (raw.length > authPasswordMaxLength)
    return uiText('密码不能超过 {0} 位', { '0': authPasswordMaxLength });
  return null;
}

export function validateAuthName(raw: string, locale: Locale = getLocale()): string | null {
  const uiText = createTranslator(messages, locale);
  const name = raw.trim();
  if (!name) return uiText('请输入名称');
  if (name.length > authNameMaxLength)
    return uiText('名称不能超过 {0} 个字符', { '0': authNameMaxLength });
  return null;
}

/** Client-side gate for sign-in; the server still revalidates everything. */
export function validateSignInForm(
  input: { email: string; password: string },
  locale: Locale = getLocale(),
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const email = validateAuthEmail(input.email, locale);
  if (email) errors.email = email;
  const password = validateAuthPassword(input.password, locale);
  if (password) errors.password = password;
  return errors;
}

export function validateSignUpForm(
  input: { name: string; email: string; password: string },
  locale: Locale = getLocale(),
): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const name = validateAuthName(input.name, locale);
  if (name) errors.name = name;
  const email = validateAuthEmail(input.email, locale);
  if (email) errors.email = email;
  const password = validateAuthPassword(input.password, locale);
  if (password) errors.password = password;
  return errors;
}

export function hasAuthFieldErrors(errors: AuthFieldErrors): boolean {
  return Object.values(errors).some(Boolean);
}

export type AuthFieldFlags = Partial<Record<keyof AuthFieldErrors, true>>;
export function authFieldFlags(errors: AuthFieldErrors): AuthFieldFlags {
  return Object.fromEntries(
    Object.entries(errors)
      .filter(([, value]) => Boolean(value))
      .map(([key]) => [key, true]),
  );
}

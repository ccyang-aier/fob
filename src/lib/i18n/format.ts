import { getLocale, type Locale } from './locale';

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: Locale = getLocale(),
) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(
  value: Date | number | string,
  options?: Intl.DateTimeFormatOptions,
  locale: Locale = getLocale(),
) {
  return new Intl.DateTimeFormat(locale, options).format(new Date(value));
}
export function formatRelative(
  value: number,
  unit: Intl.RelativeTimeFormatUnit,
  locale: Locale = getLocale(),
) {
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
}
export function plural(
  value: number,
  forms: { one: string; other: string },
  locale: Locale = getLocale(),
) {
  return new Intl.PluralRules(locale).select(value) === 'one' ? forms.one : forms.other;
}

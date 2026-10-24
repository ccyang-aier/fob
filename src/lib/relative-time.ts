/**
 * 相对时间格式化：探测/会话时间戳的统一人类可读表达。
 */

import { getLocale, type Locale } from './i18n/locale';

export function formatRelativeTime(
  ts: number | null | undefined,
  locale: Locale = getLocale(),
): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 0) return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  if (diff < 60_000) return locale === 'zh-CN' ? '1 分钟内' : 'Less than a minute ago';
  const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diff < 3_600_000) return relative.format(-Math.floor(diff / 60_000), 'minute');
  if (diff < 86_400_000) return relative.format(-Math.floor(diff / 3_600_000), 'hour');
  return new Date(ts).toLocaleString(locale, { hour12: false });
}

/** Shared document metadata dates for folder and collection lists. */
export function documentRelativeTime(value: string, now: number, locale: string, justNow: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '—';
  const minutes = Math.max(0, now - timestamp) / 60_000;
  if (minutes < 1) return justNow;
  const [amount, unit] = minutes < 60 ? [Math.round(minutes), 'minute'] : minutes < 1440 ? [Math.round(minutes / 60), 'hour'] : minutes < 43200 ? [Math.round(minutes / 1440), 'day'] : minutes < 525600 ? [Math.round(minutes / 43200), 'month'] : [Math.round(minutes / 525600), 'year'];
  return new Intl.RelativeTimeFormat(locale).format(-Math.max(1, amount as number), unit as Intl.RelativeTimeFormatUnit);
}

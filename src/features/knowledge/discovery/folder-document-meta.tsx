import type { DiscoveryDocument } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

export function FolderDocumentMeta({ document, viewerId, now }: { document: DiscoveryDocument; viewerId?: string; now: number }) {
  const { t, locale } = useTranslation(messages);
  const relative = (value: string) => {
    const delta = Math.max(0, now - Date.parse(value)), minutes = delta / 60_000;
    if (minutes < 1) return t('lessThanMinute');
    const [amount, unit] = minutes < 60 ? [Math.round(minutes), 'minute'] : minutes < 1440 ? [Math.round(minutes / 60), 'hour'] : minutes < 43200 ? [Math.round(minutes / 1440), 'day'] : minutes < 525600 ? [Math.round(minutes / 43200), 'month'] : [Math.round(minutes / 525600), 'year'];
    return new Intl.RelativeTimeFormat(locale).format(-Math.max(1, amount as number), unit as Intl.RelativeTimeFormatUnit);
  };
  const changed = document.createdAt !== null && Math.abs(Date.parse(document.updatedAt) - Date.parse(document.createdAt)) > 60_000;
  const authored = document.createdBy === viewerId || !document.createdBy ? t('youCreated') : t('personCreated', { name: document.creatorName });
  return <span className={styles.documentMeta}>
    <span>{changed || !document.createdAt ? t('lastUpdated') : authored} <time dateTime={changed ? document.updatedAt : document.createdAt ?? document.updatedAt} title={new Date(changed ? document.updatedAt : document.createdAt ?? document.updatedAt).toLocaleString(locale)}>{relative(changed ? document.updatedAt : document.createdAt ?? document.updatedAt)}</time></span>
    {document.lastViewedAt && <span><span className={styles.metaSeparator}>•</span>{t('viewed')} <time dateTime={document.lastViewedAt}>{relative(document.lastViewedAt)}</time></span>}
  </span>;
}

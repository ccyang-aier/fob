import type { DiscoveryDocument } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import { documentRelativeTime } from '../documents/document-relative-time';
import styles from './discovery.module.css';

export function FolderDocumentMeta({ document, viewerId, now }: { document: DiscoveryDocument; viewerId?: string; now: number }) {
  const { t, locale } = useTranslation(messages);
  const relative = (value: string) => documentRelativeTime(value, now, locale, t('lessThanMinute'));
  const changed = document.createdAt !== null && Math.abs(Date.parse(document.updatedAt) - Date.parse(document.createdAt)) > 60_000;
  const authored = document.createdBy === viewerId || !document.createdBy ? t('youCreated') : t('personCreated', { name: document.creatorName });
  return <span className={styles.documentMeta}>
    <span>{changed || !document.createdAt ? t('lastUpdated') : authored} <time dateTime={changed ? document.updatedAt : document.createdAt ?? document.updatedAt} title={new Date(changed ? document.updatedAt : document.createdAt ?? document.updatedAt).toLocaleString(locale)}>{relative(changed ? document.updatedAt : document.createdAt ?? document.updatedAt)}</time></span>
    {document.lastViewedAt && <span><span className={styles.metaSeparator}>•</span>{t('viewed')} <time dateTime={document.lastViewedAt}>{relative(document.lastViewedAt)}</time></span>}
  </span>;
}

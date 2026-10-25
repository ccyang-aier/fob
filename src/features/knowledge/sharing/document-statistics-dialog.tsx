'use client';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { useDocumentStatistics } from './collaboration-api';
import { DocumentModal } from './document-modal';
import { DocumentAvatar } from './document-share-dialog';
import { messages } from './collaboration.messages';
import styles from './document-collaboration.module.css';

export function DocumentStatisticsDialog({ scope, onClose }: { scope: PageScope; onClose(): void }) {
  const { t, locale } = useTranslation(messages), query = useDocumentStatistics(scope), data = query.data;
  const date = (value: string) => new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <DocumentModal title={t('statistics')} onClose={onClose}>
    {query.isPending ? <p className={styles.empty} role="status">{t('loading')}</p> : !data ? <div className={styles.state}><AppAlert tone="error" title={query.error instanceof Error ? query.error.message : t('failed')} /><Button variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <div className={styles.stats}>
      <div className={styles.metrics}>{(['characters', 'words', 'paragraphs'] as const).map(key => <div className={styles.metric} key={key}><strong>{data[key].toLocaleString(locale)}</strong><span>{t(key)}</span></div>)}</div>
      <div className={styles.readers}><span>{t('readingTime')} · {data.readingSeconds < 60 ? t('seconds', { count: data.readingSeconds }) : t('minutes', { count: Math.ceil(data.readingSeconds / 60) })}</span><span>{t('versions')} · {data.versions}</span></div>
      <h3>{t('source')}</h3><dl className={styles.dates}><dt>{t('created')}</dt><dd><time dateTime={data.createdAt}>{date(data.createdAt)}</time></dd><dt>{t('updatedAt')}</dt><dd><time dateTime={data.updatedAt}>{date(data.updatedAt)}</time></dd></dl>
      <h3>{t('contributors')}</h3>{data.contributors.map(person => <div key={person.id} className={styles.row}><DocumentAvatar name={person.name} image={person.image} /><div className={styles.rowText}><strong>{person.name}</strong><small>{person.creator ? t('creator') : person.versions ? t('contributedVersions', { count: person.versions }) : t('contributor')}</small></div></div>)}
      <h3>{t('recentReaders')}</h3><div className={styles.readers}><span>{t('views')} · {data.views}</span><span>{t('readers')} · {data.uniqueReaders}</span></div>
      {data.readers.length ? data.readers.map(person => <div key={person.id} className={styles.row}><DocumentAvatar name={person.name} image={person.image} /><div className={styles.rowText}><strong>{person.name}</strong><small><time dateTime={person.lastViewedAt}>{date(person.lastViewedAt)}</time></small></div><span className={styles.level}>{person.views}</span></div>) : <p className={styles.empty}>{t('noReaders')}</p>}
    </div>}
  </DocumentModal>;
}

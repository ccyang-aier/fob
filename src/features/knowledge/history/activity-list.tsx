'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { DocumentAvatar } from '../sharing/document-share-dialog';
import { activityMessages } from './activity.messages';
import styles from './history-panel.module.css';

type ActivityEntry = { id?: string; userId: string | null; name: string | null; image: string | null; occurredAt: string };
export function ActivityList({ entries, kind }: { entries: ActivityEntry[]; kind: 'readers' | 'edits' }) {
  const { t, locale } = useTranslation(activityMessages);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!entries.length) return <p className={styles.empty}>{t(kind === 'readers' ? 'noReaders' : 'noEdits')}</p>;
  return <ul className={styles.activityList}>{entries.map(entry => {
    const name = entry.name || t(kind === 'readers' ? 'unknownReader' : 'unknownEditor');
    const elapsed = Math.max(0, now - Date.parse(entry.occurredAt));
    const time = elapsed < 60_000 ? t('justNow') : elapsed < 3_600_000 ? t('minutesAgo', { count: Math.floor(elapsed / 60_000) }) : formatter.format(new Date(entry.occurredAt));
    return <li key={entry.id ?? entry.userId} className={styles.activityEntry}>
      <DocumentAvatar name={name} image={entry.image} />
      <span className={styles.activityPerson}><span>{name}</span>{kind === 'edits' && <small>{t('edited')}</small>}</span>
      <time dateTime={entry.occurredAt} title={formatter.format(new Date(entry.occurredAt))}>{time}</time>
    </li>;
  })}</ul>;
}

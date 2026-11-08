'use client';
import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { DocumentAvatar } from '../sharing/document-share-dialog';
import { activityMessages } from './activity.messages';
import styles from './history-panel.module.css';

type ActivityEntry = { userId: string; name: string | null; image: string | null; occurredAt: string };
export function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  const { t, locale } = useTranslation(activityMessages);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);
  const formatter = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  if (!entries.length) return <p className={styles.empty}>{t('noReaders')}</p>;
  return <ul className={styles.activityList}>{entries.map(entry => {
    const name = entry.name || t('unknownReader');
    const elapsed = Math.max(0, now - Date.parse(entry.occurredAt));
    const time = elapsed < 60_000 ? t('justNow') : elapsed < 3_600_000 ? t('minutesAgo', { count: Math.floor(elapsed / 60_000) }) : formatter.format(new Date(entry.occurredAt));
    return <li key={entry.userId} className={styles.activityEntry}>
      <DocumentAvatar name={name} image={entry.image} />
      <span className={styles.activityPerson}>{name}</span>
      <time dateTime={entry.occurredAt} title={formatter.format(new Date(entry.occurredAt))}>{time}</time>
    </li>;
  })}</ul>;
}

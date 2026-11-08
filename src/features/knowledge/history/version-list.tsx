'use client';
import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { messages } from '../sharing/collaboration.messages';
import { activityMessages } from './activity.messages';
import type { PageCheckpointEntry } from './history-api';
import styles from './history-panel.module.css';

export function VersionList({ entries, selectedId, onSelect }: { entries: PageCheckpointEntry[]; selectedId: string | null; onSelect(id: string): void }) {
  const { t, locale } = useTranslation(activityMessages);
  const { t: versionT } = useTranslation(messages);
  const [today] = useState(() => new Date());
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  const date = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' });
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' });
  const groups = new Map<string, PageCheckpointEntry[]>();
  for (const entry of entries) {
    const key = date.format(new Date(entry.createdAt));
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }
  return [...groups].map(([day, versions]) => <div key={day} className={styles.versionGroup}>
    <h3>{day === date.format(today) ? t('today') : day === date.format(yesterday) ? t('yesterday') : day}</h3>
    {versions.map(entry => <button key={entry.checkpointId} type="button" className={`fob-action ${styles.version}`} data-active={selectedId === entry.checkpointId || undefined}
      aria-current={selectedId === entry.checkpointId ? 'true' : undefined} onClick={() => onSelect(entry.checkpointId)}>
      <strong>{entry.label === 'Before restore' ? versionT('beforeRestore') : entry.label === 'Restored version' ? versionT('restoredVersion') : entry.label ?? time.format(new Date(entry.createdAt))}</strong>
      <small>{entry.authorDetails?.map(person => person.name).join(locale === 'zh-CN' ? '、' : ', ') || t('unknownEditor')}</small>
    </button>)}
  </div>);
}

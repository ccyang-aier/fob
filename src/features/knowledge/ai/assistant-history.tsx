'use client';

import { useEffect, useRef, useState } from 'react';
import { ClockCounterClockwise, Trash } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relative-time';
import { assistantMessages } from './assistant.messages';
import styles from './assistant.module.css';

export function AssistantHistory({ items, loading, failed, selectedId, onSelect, onRemove, onRetry }: {
  items: readonly { id: string; title: string; updatedAt: string }[]; loading: boolean; failed: boolean; selectedId: string | null;
  onSelect(id: string): void; onRemove(id: string): Promise<void>; onRetry(): void;
}) {
  const { t, locale } = useTranslation(assistantMessages), { notify } = useAppAlert();
  const [filter, setFilter] = useState(''), [removeId, setRemoveId] = useState<string | null>(null), [pending, setPending] = useState(false);
  const active = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const results = items.filter(item => item.title.toLocaleLowerCase(locale).includes(filter.trim().toLocaleLowerCase(locale)));
  async function remove() {
    if (!removeId || pending) return;
    setPending(true);
    try { await onRemove(removeId); if (active.current) setRemoveId(null); }
    catch { if (active.current) notify('error', t('failed')); }
    finally { if (active.current) setPending(false); }
  }
  return <section className={styles.history} aria-label={t('history')}>
    <header><h3>{t('history')}</h3><span>{items.length}</span></header>
    <input type="search" aria-label={t('searchHistory')} placeholder={t('searchHistory')} value={filter} onChange={event => setFilter(event.target.value)} />
    {loading ? <p className={styles.historyEmpty} role="status">{t('loading')}</p> : failed ? <AppAlert tone="error" title={t('failed')} action={<Button type="button" variant="ghost" size="sm" onClick={onRetry}>{t('retry')}</Button>} /> : results.length ? <ul className={styles.historyList}>{results.map(item => <li key={item.id}>
      <button type="button" className={`fob-action ${styles.historyItem}`} aria-current={selectedId === item.id ? 'true' : undefined} disabled={pending} onClick={() => onSelect(item.id)}>
        <ClockCounterClockwise size={14} aria-hidden /><span><strong>{item.title || t('unknown')}</strong><time dateTime={item.updatedAt}>{formatRelativeTime(Date.parse(item.updatedAt), locale)}</time></span>
      </button><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={`${t('remove')} · ${item.title || t('unknown')}`} disabled={pending} onClick={() => setRemoveId(item.id)}><Trash size={12} aria-hidden /></button>
    </li>)}</ul> : <p className={styles.historyEmpty}>{t(items.length ? 'noMatchingHistory' : 'emptyHistory')}</p>}
    {removeId && <AppAlert tone="warning" title={t('removeConfirm')} action={<><Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setRemoveId(null)}>{t('cancel')}</Button><Button type="button" variant="outline" size="sm" loading={pending} onClick={() => void remove()}>{t('remove')}</Button></>} />}
  </section>;
}

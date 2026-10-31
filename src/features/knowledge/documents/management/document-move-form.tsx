'use client';

import { useRef, useState } from 'react';
import { FolderSimple, SelectionCheck } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { messages } from './document-management.messages';
import styles from './document-management.module.css';

export function DocumentMoveForm({ folders, server, onMove, onClose, onBusyChange }: {
  folders: { id: string; name: string }[];
  server: boolean;
  onMove: (id: string) => Promise<void>;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const { t } = useTranslation(messages);
  const [query, setQuery] = useState('');
  const [selected, select] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const visible = folders.filter(folder => folder.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const valid = folders.some(folder => folder.id === selected);
  async function submit() {
    if (!valid || pending.current) return;
    pending.current = true;
    setBusy(true); onBusyChange(true); setError('');
    try { await onMove(selected); onClose(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { pending.current = false; setBusy(false); onBusyChange(false); }
  }
  return <form onSubmit={event => { event.preventDefault(); void submit(); }}>
    <input type="search" autoFocus className={styles.search} aria-label={t('search')} placeholder={t('search')} value={query} disabled={busy} onChange={event => setQuery(event.target.value)} />
    <div className={styles.folders} role="group" aria-label={t('destination')}>
      {visible.map(folder => <label key={folder.id} className={`fob-action ${styles.folder}`} data-surface="plain" data-active={selected === folder.id}>
        <input type="radio" name="destination" value={folder.id} checked={selected === folder.id} disabled={busy} onChange={() => { select(folder.id); setError(''); }} />
        <FolderSimple aria-hidden size={16} /><span>{folder.name}</span>{selected === folder.id && <SelectionCheck aria-hidden />}
      </label>)}
      {!visible.length && <p role="status" className={styles.hint}>{t(folders.length ? 'noMatches' : 'noFolders')}</p>}
    </div>
    {server && <p className={styles.hint}>{t('permissions')}</p>}
    {error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}
    <div className={styles.actions}>
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onClose}>{t('cancel')}</Button>
      <Button type="submit" size="sm" disabled={!valid} loading={busy}>{t('confirmMove')}</Button>
    </div>
  </form>;
}

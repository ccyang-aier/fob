'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

/** Keyed by the persisted title so a remote rename discards a stale local draft. */
export function GraphicBlockTitle({ value, fallback, editable, onCommit }: { value: string; fallback: string; editable: boolean; onCommit: (title: string) => void }) {
  const { t } = useTranslation(richMessages);
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const active = useRef(false);
  const editing = editable && draft !== null;
  useEffect(() => { if (editing) { input.current?.focus({ preventScroll: true }); input.current?.select(); } }, [editing]);
  const commit = () => {
    if (!active.current) return;
    active.current = false;
    if (editable && draft !== null && draft.trim() !== value) onCommit(draft.trim());
    setDraft(null);
  };
  if (editable && draft !== null) return <input ref={input} className={`${styles.titleInput} ${styles.graphicTitleInput}`} aria-label={t('blockTitle')} placeholder={fallback} maxLength={500} value={draft}
    onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === 'Enter') { event.preventDefault(); commit(); event.currentTarget.closest<HTMLElement>('[data-fob-node]')?.focus({ preventScroll: true }); }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); active.current = false; setDraft(null); event.currentTarget.closest<HTMLElement>('[data-fob-node]')?.focus({ preventScroll: true }); }
    }} />;
  return editable ? <button type="button" className={`fob-action ${styles.graphicTitle}`} data-surface="plain" data-document-export-text aria-label={`${t('renameTitle')}: ${value || fallback}`} title={value || fallback}
    onClick={() => { active.current = true; setDraft(value); }}>{value || fallback}</button>
    : <span className={styles.graphicTitle} title={value || fallback}>{value || fallback}</span>;
}

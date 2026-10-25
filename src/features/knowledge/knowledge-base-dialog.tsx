'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useAppAlert } from '@/components/app-alert-provider';
import type { KnowledgeBaseResource, KnowledgeBaseSource } from './knowledge-base';
import { messages } from './knowledge-base-switcher.messages';
import styles from './knowledge-base-switcher.module.css';

export type KnowledgeBaseAction = { kind: 'create' } | { kind: 'rename' | 'remove'; knowledgeBase: KnowledgeBaseResource };
export type KnowledgeBaseDialogResources = {
  principal: string; selectedKnowledgeBase: KnowledgeBaseResource | null; error: string | null;
  createKnowledgeBase: (name: string, source?: KnowledgeBaseSource) => Promise<KnowledgeBaseResource | null>;
  renameKnowledgeBase: (id: string, name: string) => Promise<boolean>;
  removeKnowledgeBase: (id: string) => Promise<boolean>;
};

/** The top switcher and the empty canvas share this single creation form. */
export function KnowledgeBaseDialog({ action, resources, onClose, onChanged }: {
  action: KnowledgeBaseAction; resources: KnowledgeBaseDialogResources; onClose: () => void; onChanged?: () => void;
}) {
  const { t } = useTranslation(messages);
  const { notify } = useAppAlert();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(action.kind === 'create' ? '' : action.knowledgeBase.name);
  const [source, setSource] = useState<KnowledgeBaseSource>(resources.selectedKnowledgeBase?.source ?? (resources.principal === 'guest' ? 'local' : 'server'));
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current; dialog?.showModal(); dialog?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  async function save() {
    if (saving || (action.kind !== 'remove' && !name.trim())) return;
    setSaving(true); setFailed(false);
    const ok = action.kind === 'create' ? await resources.createKnowledgeBase(name, source)
      : action.kind === 'rename' ? await resources.renameKnowledgeBase(action.knowledgeBase.id, name)
        : await resources.removeKnowledgeBase(action.knowledgeBase.id);
    setSaving(false);
    if (!ok) { setFailed(true); return; }
    notify('success', t(action.kind === 'create' ? 'created' : action.kind === 'rename' ? 'renamed' : 'removed'));
    onChanged?.(); onClose();
  }
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className={styles.header}><h2 id={titleId}>{t(action.kind)}</h2><button type="button" className="fob-action" aria-label={t('close')} disabled={saving} onClick={onClose}><X size={16} /></button></header>
      <div className={styles.body}>
        {action.kind === 'remove' ? <p>{t('deleteDescription', { name: action.knowledgeBase.name })}</p> : <label className={styles.field}>{t('name')}<input type="text" value={name} disabled={saving} maxLength={120} onChange={event => setName(event.target.value)} placeholder={t('placeholder')} autoComplete="off" /></label>}
        {action.kind === 'create' && resources.principal !== 'guest' && <fieldset className={styles.field} disabled={saving}><legend>{t('location')}</legend><div className={styles.sources}>{(['local', 'server'] as const).map(value => <label className={styles.source} key={value}><input type="radio" name="knowledge-base-source" value={value} checked={source === value} onChange={() => setSource(value)} />{t(value)}</label>)}</div></fieldset>}
        {failed && <span role="alert" className={styles.error}>{resources.error ?? t('failed')}</span>}
      </div>
      <footer className={styles.footer}><Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant={action.kind === 'remove' ? 'ghost' : 'default'} data-variant={action.kind === 'remove' ? 'destructive' : undefined} className={action.kind === 'remove' ? 'bg-[var(--danger-action-bg)] text-white' : undefined} size="sm" loading={saving} disabled={action.kind !== 'remove' && !name.trim()}>{t(action.kind === 'create' ? 'confirm' : action.kind === 'remove' ? 'remove' : 'save')}</Button></footer>
    </form>
  </dialog>;
}

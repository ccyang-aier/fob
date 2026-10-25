'use client';

import { useRef, useState } from 'react';
import type { JSONContent } from '@tiptap/core';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n';
import { useTemplateLibrary } from './use-template-library';
import { TemplateDialog } from './template-dialog';
import { messages } from './messages';
import styles from './templates.module.css';
import { useTemplateActivity } from './use-template-activity';

export function TemplateFields({ name, description, onName, onDescription }: { name: string; description: string; onName: (value: string) => void; onDescription: (value: string) => void }) {
  const { t } = useTranslation(messages);
  return <><label className={styles.field}><span>{t('name')}</span><input autoFocus value={name} onChange={event => onName(event.target.value)} maxLength={120} required /></label><label className={styles.field}><span>{t('description')}</span><textarea value={description} placeholder={t('optional')} maxLength={1000} rows={3} onChange={event => onDescription(event.target.value)} /></label></>;
}

export function SaveTemplateDialog({ sourcePageId, title, getBody, onClose, onSaved }: { sourcePageId: string; title: string; getBody?: () => JSONContent | undefined; onClose: () => void; onSaved?: () => void }) {
  const { t } = useTranslation(messages);
  const library = useTemplateLibrary();
  const [name, setName] = useState(title.slice(0, 120));
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const { notify } = useAppAlert();
  const beginActivity = useTemplateActivity();
  async function save() {
    if (lock.current || !name.trim()) return;
    lock.current = true; setBusy(true); setError('');
    const current = beginActivity();
    try { await library.save(sourcePageId, name, description, getBody?.()); if (current()) { notify('success', t('saved')); onSaved?.(); } onClose(); }
    catch (error) { if (current()) setError(error instanceof Error ? error.message : t('failed')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <TemplateDialog title={t('save')} onClose={onClose} busy={busy} footer={<><Button variant="outline" disabled={busy} onClick={onClose}>{t('cancel')}</Button><Button loading={busy} disabled={!name.trim()} onClick={() => void save()}>{t('save')}</Button></>}>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); void save(); }}><fieldset disabled={busy}><TemplateFields name={name} description={description} onName={setName} onDescription={setDescription} /><p className={styles.hint}>{t('snapshot')}</p></fieldset><button type="submit" hidden />{error && <AppAlert tone="error" title={error} />}</form>
  </TemplateDialog>;
}

'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { SelectionCheck, UploadSimple, X } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useTranslation } from '@/lib/i18n';
import { avatarFamilies, avatarPresets } from '../avatar-presets';
import { AvatarUploadError, prepareAvatar } from '../avatar-upload';
import { messages } from './i18n/avatar-picker.messages';
import styles from './avatar-picker.module.css';

export function AvatarPicker({ name, image, onSave, onClose }: {
  name: string; image?: string | null; onSave: (image: string | null) => Promise<void>; onClose: () => void;
}) {
  const { t } = useTranslation(messages);
  const [draft, setDraft] = useState(image ?? null), [processing,setProcessing] = useState(false), [saving,setSaving] = useState(false), [error,setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null), fileInput = useRef<HTMLInputElement>(null), returnFocus = useRef<HTMLElement | null>(null), pending = useRef(false), lifetime = useRef({ active: false, revision: 0 });
  useEffect(() => {
    const scope = lifetime.current; scope.active = true;
    if (dialog.current && !dialog.current.open) { returnFocus.current = document.activeElement as HTMLElement; dialog.current.showModal(); }
    return () => { scope.active = false; scope.revision++; };
  }, []);
  function dismiss() {
    const trigger = returnFocus.current;
    dialog.current?.close(); onClose();
    window.requestAnimationFrame(() => { if (trigger?.isConnected && document.activeElement === document.body) trigger.focus({ preventScroll: true }); });
  }
  const close = () => { if (!pending.current && !processing) dismiss(); };
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    const scope = lifetime.current, revision = ++scope.revision;
    setProcessing(true); setError('');
    try { const image = await prepareAvatar(file); if (scope.active && revision === scope.revision) setDraft(image); }
    catch (cause) { if (scope.active && revision === scope.revision) setError(t(cause instanceof AvatarUploadError ? cause.code : 'decode')); }
    finally { if (scope.active && revision === scope.revision) setProcessing(false); }
  }
  async function save() {
    if (pending.current || processing || draft === (image ?? null)) return;
    pending.current = true; setSaving(true); setError('');
    const scope = lifetime.current;
    try { await onSave(draft); if (scope.active) dismiss(); }
    catch { if (scope.active) setError(t('failed')); }
    finally { pending.current = false; if (scope.active) setSaving(false); }
  }
  return <dialog ref={dialog} className={styles.dialog} aria-label={t('title')}
    onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }} onClose={event => { event.stopPropagation(); onClose(); }}
    onClick={event => { if (event.target === event.currentTarget) close(); }}>
    <header className={styles.header}><h2>{t('title')}</h2><Button variant="ghost" size="icon-sm" aria-label={t('close')} disabled={saving || processing} onClick={close}><X size={16} aria-hidden /></Button></header>
    <div className={styles.body}>
      <div className={styles.upload}><span aria-label={t('selected')}><UserAvatar name={name} image={draft} className={styles.preview} /></span><div><Button variant="outline" disabled={saving || processing} onClick={() => fileInput.current?.click()}><UploadSimple size={16} aria-hidden />{t('upload')}</Button><p role={processing ? 'status' : undefined}>{t(processing ? 'processing' : 'uploadHint')}</p></div></div>
      <input ref={fileInput} hidden aria-hidden type="file" accept="image/png,image/jpeg,image/webp" tabIndex={-1} onChange={event => void upload(event)} />
      {error ? <AppAlert tone="error" title={error} /> : null}
      {avatarFamilies.map(family => <section key={family} className={styles.family} aria-label={t(family)}><div className={styles.grid}>{avatarPresets.filter(preset => preset.family === family).map(preset => {
        const image = new URL(preset.image,window.location.origin).href;
        return <button type="button" key={preset.id} className={`fob-action ${styles.choice}`} data-surface="plain" aria-label={t('preset',{ family: t(family),number: preset.number })} aria-pressed={draft === image} disabled={saving || processing} onClick={() => { setDraft(image); setError(''); }}>
          <UserAvatar image={preset.image} className={styles.portrait} />{draft === image ? <span className={styles.check}><SelectionCheck /></span> : null}
        </button>;
      })}</div></section>)}
    </div>
    <footer className={`fob-dialog-footer ${styles.footer}`}><Button variant="ghost" className={styles.clear} disabled={saving || processing || !draft} onClick={() => setDraft(null)}>{t('clear')}</Button><Button variant="outline" disabled={saving || processing} onClick={close}>{t('cancel')}</Button><Button loading={saving} disabled={processing || draft === (image ?? null)} onClick={() => void save()}>{t('use')}</Button></footer>
  </dialog>;
}

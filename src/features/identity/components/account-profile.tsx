'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircle, X } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n/react';
import { fobAuthApi } from '../auth-api';
import { authErrorCopyFor } from '../auth-errors';
import { useIdentity } from '../identity-context';
import { authNameMaxLength, validateAuthName } from '../validation';
import { messages } from './i18n/account-profile.messages';
import styles from './account-profile.module.css';

/** A focused editor for the existing identity service; the profile itself remains a full page. */
export function AccountProfile({ onClose }: { onClose: () => void }) {
  const { t, locale } = useTranslation(messages);
  const { session, refresh } = useIdentity();
  const { notify } = useAppAlert();
  const [name, setName] = useState(session.status === 'authenticated' ? session.user.name : '');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const nameId = useId();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    element?.querySelector<HTMLInputElement>('input')?.focus();
  }, []);
  if (session.status !== 'authenticated') return null;
  const { user } = session;

  function dismiss() {
    if (pending.current) return;
    dialog.current?.close();
    onClose();
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const invalid = validateAuthName(name, locale);
    setNameError(invalid);
    if (invalid || name.trim() === user.name) return;
    pending.current = true; setSaving(true); setError(null);
    try {
      await fobAuthApi.updateProfile({ name: name.trim() });
      const updated = await refresh();
      if (updated.status === 'error') throw updated.error;
      if (updated.status === 'authenticated' && updated.user.id === user.id) {
        notify('success', t('个人资料已更新'));
        dialog.current?.close();
        onClose();
      }
    } catch (cause) { setError(cause); }
    finally { pending.current = false; setSaving(false); }
  }

  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} onClose={onClose} onCancel={event => { event.preventDefault(); dismiss(); }} onClick={event => { if (event.target === event.currentTarget) dismiss(); }}>
    <header className={styles.header}><h2 id={titleId}>{t('编辑资料')}</h2><Button type="button" variant="ghost" size="icon-sm" disabled={saving} onClick={dismiss} aria-label={t('关闭资料窗口')}><X size={16} aria-hidden /></Button></header>
    <form className={styles.editor} noValidate onSubmit={event => void saveProfile(event)} aria-label={t('编辑资料')} aria-busy={saving}>
      <div className={styles.basics}>
        <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
        <div className={styles.field}>
          <label htmlFor={nameId}>{t('显示名称')}</label>
          <input id={nameId} name="name" autoComplete="name" autoFocus required maxLength={authNameMaxLength} readOnly={saving}
            aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${nameId}-error` : undefined}
            value={name} onBlur={() => setNameError(validateAuthName(name, locale))}
            onChange={event => { setName(event.target.value); setNameError(null); setError(null); }} />
          {nameError ? <p id={`${nameId}-error`} className={styles.error} role="alert">{nameError}</p> : null}
        </div>
      </div>
      <div className={styles.email}><span>{t('邮箱')}</span><div><span>{user.email}</span><small>{user.emailVerified ? <CheckCircle size={13} aria-hidden /> : null}{t(user.emailVerified ? '已验证' : '未验证')}</small></div></div>
      {error ? <div className={styles.feedback}><AppAlert tone="error" title={authErrorCopyFor(error, locale).description} /></div> : null}
      <footer className={'fob-dialog-footer ' + styles.actions}><Button type="button" variant="outline" disabled={saving} onClick={dismiss}>{t('取消')}</Button><Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === user.name}>{t('保存更改')}</Button></footer>
    </form>
  </dialog>;
}

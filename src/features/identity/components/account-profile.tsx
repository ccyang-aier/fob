'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { CheckCircle } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { useTranslation } from '@/lib/i18n/react';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { fobAuthApi } from '../auth-api';
import { authErrorCopyFor } from '../auth-errors';
import { useIdentity } from '../identity-context';
import { presenceDisplay } from '../presence';
import { authNameMaxLength, validateAuthName } from '../validation';
import { ProfileBackdrop } from './profile-backdrop';
import { AccountProfileActivity } from './account-profile-activity';
import { messages } from './i18n/account-profile.messages';
import styles from './account-profile.module.css';

/** Restores the compact profile from 7e67995, retaining the current identity write guards. */
export function AccountProfile({ onClose, onBusyChange }: { onClose: () => void; onBusyChange: (busy: boolean) => void }) {
  const { t, locale } = useTranslation(messages);
  const { session, refresh, presence } = useIdentity();
  const { notify } = useAppAlert();
  const [name, setName] = useState(session.status === 'authenticated' ? session.user.name : '');
  const [saving, setSaving] = useState(false), [nameError, setNameError] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const pending = useRef(false), nameId = useId();
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  const status = presenceDisplay(presence, locale);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current) return;
    const invalid = validateAuthName(name, locale);
    setNameError(invalid);
    if (invalid || name.trim() === user.name) return;
    pending.current = true; setSaving(true); onBusyChange(true); setError(null);
    try {
      await fobAuthApi.updateProfile({ name: name.trim() });
      const updated = await refresh();
      if (updated.status === 'error') throw updated.error;
      if (updated.status === 'authenticated' && updated.user.id === user.id) {
        setName(updated.user.name);
        notify('success', t('个人资料已更新'));
      }
    } catch (cause) { setError(cause); }
    finally { pending.current = false; setSaving(false); onBusyChange(false); }
  }

  return <div className={styles.profile}>
    <div className={styles.cover} aria-hidden><ProfileBackdrop /></div>
    <form noValidate onSubmit={event => void saveProfile(event)} aria-label={t('个人资料')} aria-busy={saving}>
      <div className={styles.body}>
        <div className={styles.avatarWrap}><UserAvatar name={user.name} image={user.image} className={styles.avatar} /><span className={styles.presenceDot} style={{ backgroundColor: status.color }} aria-hidden /></div>
        <div className={styles.summary}>
          <div className={styles.identity}><h2>{user.name}</h2><p><span>{user.email}</span>{user.emailVerified ? <CheckCircle size={13} className={styles.verified} aria-label={t('已验证')} /> : <small>{t('未验证')}</small>}</p></div>
          <span className={styles.status}><i style={{ backgroundColor: status.color }} aria-hidden />{status.label}</span>
        </div>
        <div className={styles.field}><label htmlFor={nameId}>{t('显示名称')}</label>
          <input id={nameId} name="name" autoComplete="name" required maxLength={authNameMaxLength} readOnly={saving} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? `${nameId}-error` : undefined}
            value={name} onBlur={() => setNameError(validateAuthName(name, locale))} onChange={event => { setName(event.target.value); setNameError(null); setError(null); }} />
          {nameError ? <p id={`${nameId}-error`} className={styles.error} role="alert">{nameError}</p> : null}
        </div>
        <KnowledgeQueryProvider><AccountProfileActivity /></KnowledgeQueryProvider>
        {error ? <AppAlert tone="error" title={authErrorCopyFor(error, locale).description} /> : null}
      </div>
      <footer className={'fob-dialog-footer ' + styles.footer}><Button type="button" variant="outline" disabled={saving} onClick={onClose}>{t('取消')}</Button><Button type="submit" loading={saving} disabled={!name.trim() || name.trim() === user.name}>{t('保存更改')}</Button></footer>
    </form>
  </div>;
}

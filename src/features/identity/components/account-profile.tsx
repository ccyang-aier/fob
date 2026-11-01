'use client';

import { useId, useRef, useState, type FormEvent } from 'react';
import { Camera, Check, CheckCircle, PencilSimple, X } from '@/components/icons';
import { UserAvatar } from '@/components/user-avatar';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n/react';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { fobAuthApi } from '../auth-api';
import { authErrorCopyFor } from '../auth-errors';
import { useIdentity } from '../identity-context';
import { presenceDisplay } from '../presence';
import { authNameMaxLength, validateAuthName } from '../validation';
import { AuthBackdrop } from './auth-backdrop';
import { AvatarPicker } from './avatar-picker';
import { AccountProfileActivity } from './account-profile-activity';
import { messages } from './i18n/account-profile.messages';
import styles from './account-profile.module.css';

type ProfileChanges = Parameters<typeof fobAuthApi.updateProfile>[0];

export function AccountProfile({ onBusyChange }: { onBusyChange: (busy: boolean) => void }) {
  const { t, locale } = useTranslation(messages);
  const { session, refresh, presence } = useIdentity();
  const { notify } = useAppAlert();
  const [name, setName] = useState(''), [signature, setSignature] = useState('');
  const [editing, setEditing] = useState(false), [avatarOpen, setAvatarOpen] = useState(false);
  const [saving, setSaving] = useState(false), [nameError, setNameError] = useState<string | null>(null), [error, setError] = useState<unknown>(null);
  const pending = useRef(false), nameInput = useRef<HTMLInputElement>(null), nameId = useId(), signatureId = useId();
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  const status = presenceDisplay(presence, locale);
  const dirty = name.trim() !== user.name || signature.trim() !== (user.signature ?? '');

  function cancelEdit() {
    if (pending.current) return;
    setEditing(false); setNameError(null); setError(null);
  }
  function edit() {
    setName(user.name); setSignature(user.signature ?? ''); setNameError(null); setError(null); setEditing(true);
    window.requestAnimationFrame(() => nameInput.current?.focus());
  }
  async function persist(changes: ProfileChanges) {
    if (pending.current) throw new Error('PROFILE_BUSY');
    pending.current = true; setSaving(true); onBusyChange(true);
    try {
      await fobAuthApi.updateProfile(changes);
      const updated = await refresh();
      if (updated.status === 'error') throw updated.error;
      if (updated.status !== 'authenticated' || updated.user.id !== user.id) throw new Error('ACCOUNT_CHANGED');
      notify('success', t('个人资料已更新'));
    } finally { pending.current = false; setSaving(false); onBusyChange(false); }
  }
  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing || pending.current) return;
    const invalid = validateAuthName(name, locale);
    setNameError(invalid);
    if (invalid) { nameInput.current?.focus(); return; }
    if (!dirty) { cancelEdit(); return; }
    setError(null);
    try { await persist({ name: name.trim(), signature: signature.trim() }); setEditing(false); }
    catch (cause) { setError(cause); }
  }

  return <div className={styles.profile}>
    <div className={styles.cover} aria-hidden><AuthBackdrop /></div>
    <form noValidate onSubmit={event => void saveProfile(event)} aria-label={t('个人资料')} aria-busy={saving}
      onKeyDown={event => { if (event.key === 'Escape' && editing) { event.preventDefault(); event.stopPropagation(); cancelEdit(); } }}>
      <div className={styles.body}>
        <div className={styles.avatarWrap}>
          <button type="button" className={styles.avatarButton} aria-label={t('更换头像')} disabled={saving} onClick={() => setAvatarOpen(true)}>
            <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
            <span className={styles.avatarOverlay}><Camera size={19} aria-hidden /></span>
          </button>
          <span className={styles.presenceDot} style={{ backgroundColor: status.color }} aria-hidden />
        </div>
        <div className={styles.summary}>
          <div className={styles.identity}>
            <input ref={nameInput} id={nameId} className={styles.name} name="name" aria-label={t('显示名称')} autoComplete="name"
              required maxLength={authNameMaxLength} readOnly={!editing || saving} tabIndex={editing ? 0 : -1}
              aria-invalid={Boolean(nameError)} aria-describedby={nameError ? nameId + '-error' : undefined}
              value={editing ? name : user.name} onBlur={() => { if (editing) setNameError(validateAuthName(name, locale)); }}
              onChange={event => { setName(event.target.value); setNameError(null); setError(null); }} />
            <p className={styles.email}><span>{user.email}</span>{user.emailVerified ? <CheckCircle size={13} className={styles.verified} aria-label={t('已验证')} /> : <small>{t('未验证')}</small>}<span className={styles.status}><i style={{ backgroundColor: status.color }} aria-hidden />{status.label}</span></p>
          </div>
          <div className={styles.editActions}>
            {editing ? <><Button type="button" variant="ghost" size="icon-sm" disabled={saving} onClick={cancelEdit} aria-label={t('取消编辑')}><X size={16} aria-hidden /></Button><Button type="submit" size="icon-sm" loading={saving} disabled={!dirty || !name.trim()} aria-label={t('保存更改')}><Check size={16} aria-hidden /></Button></> : <Tooltip><TooltipTrigger asChild><Button type="button" variant="ghost" size="icon-sm" onClick={edit} aria-label={t('编辑资料')}><PencilSimple size={16} aria-hidden /></Button></TooltipTrigger><TooltipContent>{t('编辑资料')}</TooltipContent></Tooltip>}
          </div>
        </div>
        {nameError ? <p id={nameId + '-error'} className={styles.error} role="alert">{nameError}</p> : null}
        <input id={signatureId} className={styles.signature} name="signature" aria-label={t('签名')} maxLength={160}
          value={editing ? signature : user.signature ?? ''} readOnly={!editing || saving} tabIndex={editing ? 0 : -1}
          placeholder={t(editing ? '写一句介绍自己的话' : '还没有签名')}
          onChange={event => { setSignature(event.target.value); setError(null); }} />
        {editing ? <p className={styles.editHint}>{t('点击昵称或签名即可编辑')}</p> : null}
        {error ? <AppAlert tone="error" title={authErrorCopyFor(error, locale).description} /> : null}
        <KnowledgeQueryProvider><AccountProfileActivity /></KnowledgeQueryProvider>
      </div>
    </form>
    {avatarOpen ? <AvatarPicker name={user.name} image={user.image} onSave={image => persist({ image })} onClose={() => setAvatarOpen(false)} /> : null}
  </div>;
}

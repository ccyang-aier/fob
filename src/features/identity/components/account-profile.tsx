'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/account-profile.messages';

import { useId, useState, type FormEvent } from 'react';
import { CheckCircle } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { UserAvatar } from '@/components/user-avatar';
import { fobAuthApi } from '../auth-api';
import { authErrorCopyFor } from '../auth-errors';
import { useIdentity } from '../identity-provider';
import { presenceDisplay } from '../presence';
import { authNameMaxLength, validateAuthName } from '../validation';
import { ProfileBackdrop } from './profile-backdrop';
import styles from './account-profile.module.css';

/** Account data stays in the identity provider; this form only edits the display name. */
export function AccountProfile({ onClose }: { onClose: () => void }) {
  const { t: uiText, locale } = useTranslation(messages);
  const { session, refresh, presence } = useIdentity();
  const [name, setName] = useState(session.status === 'authenticated' ? session.user.name : '');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<
    { kind: 'success' } | { kind: 'error'; cause: unknown } | null
  >(null);
  const nameId = useId();
  if (session.status !== 'authenticated') return null;
  const { user } = session;
  const status = presenceDisplay(presence, locale);

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const error = validateAuthName(name);
    setNameError(error);
    if (error || name.trim() === user.name) return;
    setSaving(true);
    setFeedback(null);
    try {
      await fobAuthApi.updateProfile({ name: name.trim() });
      const updatedSession = await refresh();
      if (updatedSession.status === 'error') throw updatedSession.error;
      if (updatedSession.status === 'authenticated') {
        setName(updatedSession.user.name);
        setFeedback({ kind: 'success' });
      }
    } catch (error) {
      setFeedback({ kind: 'error', cause: error });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={styles.profile}>
      <div className={styles.cover} aria-hidden>
        <ProfileBackdrop />
      </div>
      <form noValidate onSubmit={(event) => void saveProfile(event)}>
        <div className={styles.body}>
          <div className={styles.avatarWrap}>
            <UserAvatar name={user.name} image={user.image} className={styles.avatar} />
            <span
              aria-hidden
              className={styles.presenceDot}
              style={{ backgroundColor: status.color }}
            />
          </div>
          <div className={styles.summary}>
            <div className={styles.identity}>
              <h2 className={styles.name}>{user.name}</h2>
              <p className={styles.email}>{user.email}</p>
            </div>
            <span className={styles.status}>
              <span aria-hidden style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
          </div>
          <div className={styles.fields}>
            <div className={styles.field}>
              <label htmlFor={nameId}>{uiText('显示名称')}</label>
              <input
                id={nameId}
                name="name"
                autoComplete="name"
                required
                maxLength={authNameMaxLength}
                readOnly={saving}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? `${nameId}-error` : undefined}
                value={name}
                onBlur={() => setNameError(validateAuthName(name))}
                onChange={(event) => {
                  setName(event.target.value);
                  setNameError(null);
                  setFeedback(null);
                }}
                className={styles.input}
              />
              {nameError ? (
                <p id={`${nameId}-error`} className={styles.error} role="alert">
                  {validateAuthName(name, locale)}
                </p>
              ) : null}
            </div>
            <div className={styles.field}>
              <span className={styles.label}>{uiText('邮箱')}</span>
              <div className={styles.emailValue}>
                <span className={styles.emailAddress}>{user.email}</span>
                <span className={user.emailVerified ? styles.verified : styles.unverified}>
                  {user.emailVerified ? <CheckCircle size={12} aria-hidden /> : null}
                  {user.emailVerified ? uiText('已验证') : uiText('未验证')}
                </span>
              </div>
            </div>
          </div>
          {feedback ? (
            <AppAlert
              tone={feedback.kind === 'error' ? 'error' : 'success'}
              title={
                feedback.kind === 'success'
                  ? uiText('个人资料已更新')
                  : authErrorCopyFor(feedback.cause, locale).description
              }
            />
          ) : null}
        </div>
        <footer className={`fob-dialog-footer ${styles.footer}`}>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            {uiText('取消')}
          </Button>
          <Button
            type="submit"
            className={styles.save}
            loading={saving}
            disabled={!name.trim() || name.trim() === user.name}
          >
            {saving ? uiText('正在保存…') : uiText('保存更改')}
          </Button>
        </footer>
      </form>
    </div>
  );
}

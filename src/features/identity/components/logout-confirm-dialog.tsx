'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/logout-confirm-dialog.messages';

import { SignOut } from '@/components/icons';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { authErrorCopyFor } from '../auth-errors';
import { useIdentity } from '../identity-provider';
import styles from './logout-confirm-dialog.module.css';

export function LogoutConfirmDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t: uiText, locale } = useTranslation(messages);
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const { signOut } = useIdentity();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<{ cause: unknown } | null>(null);

  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) {
      dialog.current?.close();
      if (document.activeElement === document.body)
        document.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus();
    }
  }, [open]);

  function close() {
    if (signingOut) return;
    setError(null);
    onClose();
  }

  async function exitAccount() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
      onClose();
      // The authenticated menu unmounts after revocation; focus its guest replacement.
      window.requestAnimationFrame(() =>
        document.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus(),
      );
    } catch (cause) {
      setError({ cause });
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={signingOut}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div className={styles.body}>
        <div aria-hidden className={styles.icon}>
          <SignOut size={22} />
        </div>
        <h2 id={titleId} className={styles.title}>
          {uiText('退出当前账户？')}
        </h2>
        <p id={descriptionId} className={styles.description}>
          {uiText('退出后需重新登录才能访问账户资源，本机文档仍会保留。')}
        </p>
        {error ? (
          <AppAlert tone="error" title={authErrorCopyFor(error.cause, locale).description} />
        ) : null}
      </div>
      <footer className={styles.footer}>
        <Button type="button" variant="outline" onClick={close} disabled={signingOut}>
          {uiText('取消')}
        </Button>
        <Button
          type="button"
          variant="outline"
          data-variant="destructive"
          className={styles.danger}
          onClick={() => void exitAccount()}
          loading={signingOut}
        >
          {signingOut ? uiText('正在退出…') : uiText('退出登录')}
        </Button>
      </footer>
    </dialog>
  );
}

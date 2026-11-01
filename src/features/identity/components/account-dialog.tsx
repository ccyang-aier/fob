'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/account-dialog.messages';

import { useEffect, useRef } from 'react';
import { X } from '@/components/icons';
import { useIdentity } from '../identity-context';
import { AuthEntryContent } from './auth-entry-content';
import { AuthShowcase } from './auth-showcase';
import styles from './account-dialog.module.css';

/** Native dialog keeps focus, Escape dismissal and focus restoration in one layer. */
export function AccountDialog({
  open,
  switchingAccount = false,
  onClose,
}: {
  open: boolean;
  switchingAccount?: boolean;
  onClose: () => void;
}) {
  const uiText = useTranslation(messages).t;
  const dialog = useRef<HTMLDialogElement>(null);
  const { session } = useIdentity();
  const currentAccount =
    switchingAccount && session.status === 'authenticated' ? session.user.name : undefined;
  useEffect(() => {
    if (open && !dialog.current?.open) {
      dialog.current?.showModal();
      dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    }
    if (!open && dialog.current?.open) {
      dialog.current?.close();
      // Successful sign-in replaces the guest trigger; restore to its new node.
      if (document.activeElement === document.body)
        document.querySelector<HTMLButtonElement>('[data-account-trigger]')?.focus();
    }
  }, [open]);
  return (
    <dialog
      ref={dialog}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-label={
        switchingAccount
            ? uiText('切换账户')
            : uiText('登录 Fob')
      }
      className={styles.dialog}
    >
      {open ? (
        <>
          <button
            type="button"
            aria-label={uiText('关闭账户窗口')}
            onClick={onClose}
            className={`fob-action ${styles.close}`}
          >
            <X size={16} aria-hidden />
          </button>
          <div className={styles.login}>
              <AuthShowcase />
              <section className={styles.formPanel}>
                <AuthEntryContent
                  showBrand={false}
                  currentAccount={currentAccount}
                  targetPath={window.location.pathname + window.location.search}
                  onSuccess={onClose}
                  onDismiss={onClose}
                />
              </section>
          </div>
        </>
      ) : null}
    </dialog>
  );
}

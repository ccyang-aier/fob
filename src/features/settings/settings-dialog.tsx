'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/settings-dialog.messages';

import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';

import { SettingsCanvas, type SettingsSection } from './settings-canvas';
import styles from './settings-dialog.module.css';

export function SettingsDialog({
  open,
  section,
  onSectionChange,
  onClose,
}: {
  open: boolean;
  section: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
}) {
  const uiText = useTranslation(messages).t;
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (open && dialog && !dialog.open) {
      dialog.showModal();
      dialog
        .querySelector<HTMLButtonElement>('[aria-current="page"]')
        ?.focus({ preventScroll: true });
    } else if (!open && dialog?.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-label={uiText('设置')}
      className={styles.dialog}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className={styles.layout}>
          <button
            type="button"
            aria-label={uiText('关闭设置')}
            onClick={onClose}
            className={`fob-action ${styles.close}`}
          >
            <X size={18} aria-hidden />
          </button>
          <SettingsCanvas initialSection={section} onSectionChange={onSectionChange} />
        </div>
      ) : null}
    </dialog>
  );
}

'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { createPortal } from 'react-dom';
import { usePageVisible } from '@/lib/page-visibility';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './templates.module.css';

export function TemplateDialog({ title, onClose, busy, wide, children, footer }: { title: string; onClose: () => void; busy?: boolean; wide?: boolean; children: ReactNode; footer: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const heading = useId();
  const visible = usePageVisible();
  const { t } = useTranslation(messages);
  useEffect(() => { const dialog = ref.current; if (visible && !dialog?.open) dialog?.showModal(); else if (!visible) dialog?.close(); return () => dialog?.close(); }, [visible]);
  return typeof document === 'undefined' ? null : createPortal(<dialog ref={ref} aria-labelledby={heading} className={`${styles.dialog} ${wide ? styles.wide : ''}`} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }} onClick={event => { if (event.target === event.currentTarget && !busy) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}>
    <header className={styles.dialogHeader}><h2 id={heading}>{title}</h2><button type="button" className="fob-action" aria-label={t('close')} disabled={busy} onClick={onClose}><X size={16} /></button></header>
    <div className={styles.dialogBody}>{children}</div>
    <footer className={`fob-dialog-footer ${styles.dialogFooter}`}>{footer}</footer>
  </dialog>, document.body);
}

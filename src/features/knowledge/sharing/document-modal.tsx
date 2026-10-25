'use client';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@/components/icons';
import { useTranslation } from '@/lib/i18n';
import { messages } from './collaboration.messages';
import styles from './document-collaboration.module.css';

/** Native modal supplies focus trapping, Escape, inert background and focus restoration. */
export function DocumentModal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const { t } = useTranslation(messages), dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
  return createPortal(<dialog ref={dialog} aria-label={title} className={`${styles.surface} ${styles.modal} ${wide ? styles.wide : ''}`}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <header className={styles.modalHeader}><h2>{title}</h2><button className={`fob-action ${styles.iconButton}`} aria-label={t('close')} onClick={onClose}><X size={16} /></button></header>
    {children}
  </dialog>, document.body);
}

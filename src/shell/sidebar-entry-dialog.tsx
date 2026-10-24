'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { messages } from './i18n/navigation-sidebar.messages';
import styles from './sidebar-sections.module.css';

export type SidebarEntryAction = { kind: 'create' | 'rename' | 'delete'; resource: 'channel' | 'chat'; name: string };

export function SidebarEntryDialog({ action, nameExists, onConfirm, onClose }: {
  action: SidebarEntryAction; nameExists?: (name: string) => boolean;
  onConfirm: (name: string) => boolean; onClose: () => void;
}) {
  const { t } = useTranslation(messages);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const [name, setName] = useState(action.name);
  const deleting = action.kind === 'delete';
  const channel = action.resource === 'channel';
  const duplicate = !deleting && Boolean(nameExists?.(name.trim()));
  const title = t(channel ? action.kind === 'create' ? '新建频道' : deleting ? '删除频道' : '重命名频道' : deleting ? '删除对话' : '重命名对话');
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    if (deleting) dialog?.querySelector<HTMLButtonElement>('[data-cancel]')?.focus();
    else dialog?.querySelector('input')?.select();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [deleting]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} aria-describedby={deleting ? descriptionId : undefined} onCancel={event => { event.preventDefault(); onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); if ((deleting || name.trim() && !duplicate) && onConfirm(name.trim())) onClose(); }}>
      <header><h2 id={titleId}>{title}</h2><button type="button" className={`fob-action ${styles.action}`} onClick={onClose} aria-label={t('关闭')}><X size={16} /></button></header>
      {deleting ? <p id={descriptionId} className={styles.description}>{t(channel ? '删除频道确认' : '删除对话确认', { name: action.name })}</p> : <label className={styles.field}>{t(channel ? '频道名称' : '对话名称')}<input value={name} aria-label={t(channel ? '频道名称' : '对话名称')} aria-invalid={duplicate} aria-describedby={duplicate ? errorId : undefined} maxLength={channel ? 40 : 120} placeholder={t(channel ? '输入频道名称' : '输入对话名称')} onChange={event => setName(event.target.value)} />{duplicate && <span id={errorId} role="alert" className={styles.error}>{t('频道名称已存在')}</span>}</label>}
      <footer><Button type="button" variant="outline" size="sm" data-cancel onClick={onClose}>{t('取消')}</Button><Button type="submit" size="sm" variant={deleting ? 'ghost' : 'default'} data-variant={deleting ? 'destructive' : undefined} className={deleting ? 'bg-[var(--danger-action-bg)] text-white' : undefined} disabled={!deleting && (!name.trim() || duplicate)}>{t(deleting ? '确认删除' : '保存')}</Button></footer>
    </form>
  </dialog>;
}

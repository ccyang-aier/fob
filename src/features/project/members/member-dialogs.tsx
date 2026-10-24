'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { usePageVisible } from '@/lib/page-visibility';
import { MemberPortrait } from './member-collection';
import type { DirectoryMember } from './members.data';
import { messages } from './members.messages';
import { useTranslation } from '@/lib/i18n';
import { MemberLabelEditor } from './member-label-editor';
import styles from './members.module.css';

function MemberModal({ title, onClose, children, alert = false }: { title: string; onClose: () => void; children: ReactNode; alert?: boolean }) {
  const { t } = useTranslation(messages);
  const ref = useRef<HTMLDialogElement>(null);
  const visible = usePageVisible();
  const id = useId();
  useEffect(() => {
    const node = ref.current;
    if (!node || !visible) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal(); node.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true });
    return () => { node.close(); if (opener?.isConnected && document.activeElement === document.body) opener.focus({ preventScroll: true }); };
  }, [visible]);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={id} role={alert ? 'alertdialog' : undefined}
    onKeyDown={event => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.currentTarget.querySelector('[role="menu"][data-state="open"], [data-date-picker] [aria-expanded="true"]')) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}
    onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
      if (event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <header className={styles.dialogHeader}><h2 id={id}>{title}</h2><Button type="button" variant="ghost" size="icon-sm" aria-label={t('close')} onClick={onClose}><X size={16} /></Button></header>
    {children}
  </dialog>;
}

export function MemberDialog({ member, departments, labels, onClose, onSave, onRemove }: {
  member?: DirectoryMember; departments: string[]; labels: string[]; onClose: () => void;
  onSave: (member: DirectoryMember) => void; onRemove: (id: string) => void;
}) {
  const { t } = useTranslation(messages);
  const [draft, setDraft] = useState<DirectoryMember>(() => member ? { ...member } : {
    id: crypto.randomUUID(), name: '', position: '', department: '', email: '', phone: '', labels: [],
    joinedOn: new Date().toLocaleDateString('en-CA'), portrait: null,
  });
  const [removing, setRemoving] = useState(false);
  const departmentList = useId();
  function field(key: 'name' | 'position' | 'department' | 'email' | 'phone', value: string) { setDraft(current => ({ ...current, [key]: value })); }
  return <MemberModal title={t(removing ? 'removeTitle' : member ? 'details' : 'add')} onClose={onClose} alert={removing}>
    {removing && member ? <>
      <p className={styles.removeDescription}>{t('removeDescription', { name: member.name })}</p>
      <footer><Button type="button" variant="outline" size="sm" onClick={() => setRemoving(false)} autoFocus>{t('cancel')}</Button><Button type="button" variant="ghost" size="sm" className={styles.danger} data-variant="destructive" onClick={() => { onRemove(member.id); onClose(); }}>{t('remove')}</Button></footer>
    </> : <form onSubmit={event => { event.preventDefault(); onSave({ ...draft, name: draft.name.trim(), position: draft.position.trim(), department: draft.department.trim(), email: draft.email.trim(), phone: draft.phone.trim() }); onClose(); }}>
      <div className={styles.dialogBody}>
        {member && <div className={styles.profile}><MemberPortrait member={member} /><div><h3>{member.name}</h3><span>{member.position}</span></div></div>}
        <div className={styles.formGrid}>
          {(['name', 'position', 'department', 'email', 'phone'] as const).map(key => <label key={key} className={styles.field}>{t(key)}<input value={draft[key]} type={key === 'email' ? 'email' : key === 'phone' ? 'tel' : 'text'} required={key === 'name' || key === 'email'} maxLength={key === 'email' ? 254 : 120} list={key === 'department' ? departmentList : undefined} data-autofocus={key === 'name' ? '' : undefined} onChange={event => field(key, event.target.value)} /></label>)}
          <label className={styles.field}>{t('joined')}<DatePicker value={draft.joinedOn} required onValueChange={joinedOn => setDraft(current => ({ ...current, joinedOn }))} aria-label={t('joined')} /></label>
        </div>
        <MemberLabelEditor value={draft.labels} options={labels} onChange={labels => setDraft(current => ({ ...current, labels }))} />
        <datalist id={departmentList}>{departments.map(department => <option key={department} value={department} />)}</datalist>
      </div>
      <footer>{member && <Button type="button" variant="ghost" size="sm" data-variant="destructive" className={styles.remove} onClick={() => setRemoving(true)}>{t('remove')}</Button>}
        <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('cancel')}</Button>
        <Button type="submit" size="sm" disabled={!draft.name.trim() || !draft.email.trim()}>{t(member ? 'save' : 'add')}</Button>
      </footer>
    </form>}
  </MemberModal>;
}

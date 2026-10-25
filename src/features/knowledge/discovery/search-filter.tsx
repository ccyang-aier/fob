'use client';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Check, CaretDown, MagnifyingGlass } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

export function SearchFilter({ label, value, options, icon, onChange, disabled }: { label: string; value: string; options: { id: string; name: string }[]; icon: ReactNode; onChange(value: string): void; disabled?: boolean }) {
  const { t } = useTranslation(messages), [anchor, setAnchor] = useState<HTMLElement | null>(null), [query, setQuery] = useState('');
  const listId = useId(), list = useRef<HTMLDivElement>(null);
  const current = options.find(option => option.id === value);
  const choices = [{ id: '', name: label }, ...options].filter(option => option.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function choose(id: string) { onChange(id); setAnchor(null); }
  return <><button type="button" className={`fob-action ${styles.filter}`} data-selected={Boolean(value)} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} disabled={disabled} aria-label={current ? `${label}: ${current.name}` : label} onClick={event => { setQuery(''); setAnchor(anchor ? null : event.currentTarget); }}>{icon}<span>{current?.name ?? label}</span><CaretDown size={12} aria-hidden /></button>
    {anchor && <AnchoredPopover anchor={anchor} label={label} align="start" width={264} onClose={() => setAnchor(null)} className={styles.filterPopover}>
      <div className={styles.filterSearch}><MagnifyingGlass size={14} aria-hidden /><input data-autofocus aria-label={t('filterPlaceholder')} placeholder={t('filterPlaceholder')} aria-controls={listId} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); if (choices.length) choose(choices.find(option => option.id === value)?.id ?? choices[0].id); }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]'); if (items?.length) items[event.key === 'ArrowDown' ? 0 : items.length - 1].focus(); }
      }} /></div>
      <div ref={list} id={listId} className={styles.filterOptions} role="listbox" aria-label={label} onKeyDown={event => {
        if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')]; if (!items.length) return;
        event.preventDefault(); const index = items.indexOf(document.activeElement as HTMLButtonElement);
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
      }}>{choices.map(option => <button key={option.id} type="button" role="option" aria-selected={value === option.id} className={`fob-menu-item ${styles.filterOption}`} onClick={() => choose(option.id)}><span>{option.name}</span>{value === option.id && <Check size={14} aria-hidden />}</button>)}{!choices.length && <p>{t('noOptions')}</p>}</div>
    </AnchoredPopover>}
  </>;
}

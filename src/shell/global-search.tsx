'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import type { WorkbenchView } from './workbench-view';
import { messages } from './i18n/system-bar.messages';
import styles from './global-search.module.css';

const searchItems: Array<{ label: keyof typeof messages; detail: keyof typeof messages; view: WorkbenchView }> = [
  { label: '成员', detail: '管理项目成员', view: 'members' },
  { label: '知识库', detail: '查看沉淀的知识', view: 'knowledge' },
  { label: '设置', detail: '调整 Fob 偏好', view: 'settings' },
];

export function GlobalSearch({ onNavigate, className }: { onNavigate: (view: WorkbenchView) => void; className: string }) {
  const { t } = useTranslation(messages);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(value => !value);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <>
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className={`fob-action ${className}`} aria-label={t('全局搜索')} aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+k Meta+k" onClick={() => setOpen(true)}><MagnifyingGlass size={18} weight="duotone" aria-hidden /></button></TooltipTrigger>
      <TooltipContent side="bottom">{t('全局搜索')} · Ctrl / ⌘ K</TooltipContent>
    </Tooltip>
    {open && <SearchDialog onClose={() => setOpen(false)} onNavigate={onNavigate} />}
  </>;
}

function SearchDialog({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: WorkbenchView) => void }) {
  const { t, locale } = useTranslation(messages);
  const ref = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const normalized = query.trim().toLocaleLowerCase(locale);
  const results = searchItems.map(item => ({ ...item, label: t(item.label), detail: t(item.detail) }))
    .filter(item => `${item.label}${item.detail}`.toLocaleLowerCase(locale).includes(normalized));
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector('input')?.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { ref.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, query]);
  function navigate(view: WorkbenchView) { onClose(); onNavigate(view); }
  return <dialog ref={ref} className={styles.dialog} aria-label={t('全局搜索')} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); if (results[activeIndex]) navigate(results[activeIndex].view); }}>
      <div className={styles.field}>
        <MagnifyingGlass size={19} weight="duotone" aria-hidden />
        <input type="search" role="combobox" aria-label={t('全局搜索')} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined} placeholder={t('搜索')} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
            event.preventDefault();
            setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          }
        }} />
        <button type="button" className={`fob-action ${styles.close}`} aria-label={t('关闭搜索')} onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      <ScrollArea className={styles.results} viewportClassName={styles.resultList} style={{ height: Math.min(360, Math.max(72, results.length * 40 + 12)) }}>
      <div id={listId} role="listbox" aria-label={t('搜索结果')}>
        {results.map((item, index) => <button key={item.view} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex} data-highlighted={index === activeIndex ? '' : undefined} className={`fob-menu-item ${styles.result}`} onPointerMove={() => setSelected(index)} onMouseDown={event => event.preventDefault()} onClick={() => navigate(item.view)}>
          <MagnifyingGlass size={15} weight="duotone" aria-hidden /><span className={styles.label}>{item.label}</span><span className={styles.detail}>{item.detail}</span>
        </button>)}
        {!results.length && <p className={styles.empty} role="status">{t('没有匹配结果')}</p>}
      </div>
      </ScrollArea>
    </form>
  </dialog>;
}

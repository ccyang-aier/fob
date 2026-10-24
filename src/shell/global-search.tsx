'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { FileText, MagnifyingGlass, X } from '@phosphor-icons/react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { useIdentity } from '@/features/identity/identity-provider';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { useLocalLibrary } from '@/features/knowledge/local/use-local-library';
import { requestOpenPageBlock } from '@/features/knowledge/editor/open-target';
import { searchLocalKnowledge, type KnowledgeSearchHit, type KnowledgeSearchOutcome } from '@/features/knowledge/search/knowledge-search';
import { searchServerKnowledgeDocuments } from '@/features/knowledge/search/knowledge-search-client';
import type { WorkbenchView } from './workbench-view';
import { messages } from './i18n/system-bar.messages';
import styles from './global-search.module.css';

export function GlobalSearch({ onNavigate, className }: { onNavigate: (view: WorkbenchView) => void; className: string }) {
  const { t } = useTranslation(messages);
  const { scopeKey } = useKnowledgeBaseResources();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setOpen(value => !value);
      }
    }
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <>
    <Tooltip>
      <TooltipTrigger asChild><button type="button" className={`fob-action ${className}`} aria-label={t('搜索知识')} aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+k Meta+k" onClick={() => setOpen(true)}><MagnifyingGlass size={18} weight="duotone" aria-hidden /></button></TooltipTrigger>
      <TooltipContent side="bottom">{t('搜索知识')} · Ctrl / ⌘ K</TooltipContent>
    </Tooltip>
    {open && <SearchDialog key={scopeKey ?? 'no-knowledge-base'} onClose={() => setOpen(false)} onNavigate={onNavigate} />}
  </>;
}

type SearchState = { query: string; phase: 'loading' | 'ready' | 'error'; outcome: KnowledgeSearchOutcome };
const emptyOutcome: KnowledgeSearchOutcome = { hits: [], incomplete: false };

function SearchDialog({ onClose, onNavigate }: { onClose: () => void; onNavigate: (view: WorkbenchView) => void }) {
  const { t } = useTranslation(messages);
  const { selectedKnowledgeBase, status } = useKnowledgeBaseResources();
  const { session } = useIdentity();
  const local = useLocalLibrary();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const listId = useId();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState<SearchState>({ query: '', phase: 'ready', outcome: emptyOutcome });
  const normalized = query.trim();
  const ready = selectedKnowledgeBase !== null && status === 'ready' && (selectedKnowledgeBase.source === 'local' || session.status === 'authenticated');
  const pending = ready && normalized.length >= 2 && (state.query !== normalized || state.phase === 'loading');
  const results = ready && state.query === normalized && !pending ? state.outcome.hits : [];
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = dialogRef.current;
    dialog?.showModal(); dialog?.querySelector('input')?.focus({ preventScroll: true });
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  useEffect(() => {
    if (!ready || !selectedKnowledgeBase || normalized.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setState({ query: normalized, phase: 'loading', outcome: emptyOutcome });
      const search = selectedKnowledgeBase.source === 'local'
        ? local.error ? Promise.reject(new Error('LOCAL_STORAGE_UNAVAILABLE')) : Promise.resolve(searchLocalKnowledge(local.library, selectedKnowledgeBase, normalized))
        : searchServerKnowledgeDocuments(selectedKnowledgeBase.id, normalized, controller.signal);
      void search.then(outcome => {
        if (!controller.signal.aborted) setState({ query: normalized, phase: 'ready', outcome });
      }).catch(() => {
        if (!controller.signal.aborted) setState({ query: normalized, phase: 'error', outcome: emptyOutcome });
      });
    }, 200);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [normalized, selectedKnowledgeBase, ready, local.library, local.error, retry]);

  useEffect(() => { dialogRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, results.length]);

  function openDocument(hit: KnowledgeSearchHit) {
    onClose(); onNavigate('knowledge');
    requestAnimationFrame(() => requestOpenPageBlock({ knowledgeBaseId: hit.knowledgeBaseId, pageId: hit.pageId, blockId: hit.blockId }));
  }
  const failed = ready && normalized.length >= 2 && state.query === normalized && state.phase === 'error';
  return <dialog ref={dialogRef} className={styles.dialog} aria-label={t('搜索知识')} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); if (results[activeIndex]) openDocument(results[activeIndex]); }}>
      <div className={styles.field}>
        <MagnifyingGlass size={19} weight="duotone" aria-hidden />
        <input type="search" role="combobox" maxLength={200} aria-label={t('搜索知识')} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined} placeholder={t('搜索文档标题和正文')} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => {
          if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
            event.preventDefault(); setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length);
          }
        }} />
        <button type="button" className={`fob-action ${styles.close}`} aria-label={t('关闭搜索')} onClick={onClose}><X size={16} aria-hidden /></button>
      </div>
      {ready && <p className={styles.scope}>{t('搜索知识库', { name: selectedKnowledgeBase!.name })}</p>}
      <ScrollArea className={styles.results} viewportClassName={styles.resultList} style={{ height: Math.min(420, Math.max(96, results.length * 68 + 12)) }}>
        <div id={listId} role="listbox" aria-label={t('搜索结果')} aria-busy={pending}>
          {results.map((hit, index) => <button key={`${hit.source}:${hit.knowledgeBaseId}:${hit.pageId}`} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex} data-highlighted={index === activeIndex ? '' : undefined} className={`fob-menu-item ${styles.result}`} onPointerMove={() => setSelected(index)} onMouseDown={event => event.preventDefault()} onClick={() => openDocument(hit)}>
            <FileText size={17} aria-hidden /><span className={styles.resultText}><span className={styles.label}>{hit.title}</span>{hit.snippet && <span className={styles.detail}>{hit.snippet}</span>}</span>
          </button>)}
        </div>
        {!ready && <p className={styles.empty} role="status">{t('请先选择知识库')}</p>}
        {ready && normalized.length < 2 && <p className={styles.empty} role="status">{t('输入至少两个字符开始搜索')}</p>}
        {pending && <p className={styles.empty} role="status">{t('正在搜索知识')}</p>}
        {failed && <div className={styles.empty} role="alert"><p>{t('知识搜索暂不可用')}</p><button type="button" className={`fob-action ${styles.retry}`} onClick={() => setRetry(value => value + 1)}>{t('重试')}</button></div>}
        {ready && normalized.length >= 2 && !pending && !failed && !results.length && <p className={styles.empty} role="status">{t('没有找到相关文档')}</p>}
      </ScrollArea>
      {state.query === normalized && state.outcome.incomplete && <p className={styles.notice} role="status">{t('部分搜索暂不可用')}</p>}
    </form>
  </dialog>;
}

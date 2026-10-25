'use client';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Folder, MagnifyingGlass, User, X } from '@/components/icons';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { useIdentity } from '@/features/identity/identity-provider';
import { useKnowledgeBaseResources } from '@/features/knowledge/data/knowledge-base-resources';
import { KnowledgeQueryProvider } from '@/features/knowledge/data/provider';
import { useLocalLibrary } from '@/features/knowledge/local/use-local-library';
import { requestOpenPageBlock } from '@/features/knowledge/editor/open-target';
import { searchLocalKnowledge, type KnowledgeSearchHit } from '@/features/knowledge/search/knowledge-search';
import { searchServerKnowledgeDocuments } from '@/features/knowledge/search/knowledge-search-client';
import { fetchDiscoveryFacets } from '@/features/knowledge/discovery/api';
import { SearchFilter } from '@/features/knowledge/discovery/search-filter';
import { messages } from '@/features/knowledge/discovery/messages';
import type { WorkbenchView } from './workbench-view';
import styles from './global-search.module.css';

export function GlobalSearch({ onNavigate, className }: { onNavigate: (view: WorkbenchView) => void; className: string }) {
  const { t } = useTranslation(messages), { scopeKey } = useKnowledgeBaseResources(), [open, setOpen] = useState(false);
  useEffect(() => {
    function shortcut(event: KeyboardEvent) { if (!event.defaultPrevented && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setOpen(value => !value); } }
    window.addEventListener('keydown', shortcut); return () => window.removeEventListener('keydown', shortcut);
  }, []);
  return <><Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${className}`} aria-label={t('search')} aria-haspopup="dialog" aria-expanded={open} aria-keyshortcuts="Control+k Meta+k" onClick={() => setOpen(true)}><MagnifyingGlass size={16} aria-hidden /></button></TooltipTrigger><TooltipContent side="bottom">{t('search')} · Ctrl / ⌘ K</TooltipContent></Tooltip>
    {open && <KnowledgeQueryProvider key={scopeKey ?? 'no-knowledge-base'}><SearchDialog onClose={() => setOpen(false)} onNavigate={onNavigate} /></KnowledgeQueryProvider>}</>;
}

function SearchDialog({ onClose, onNavigate }: { onClose(): void; onNavigate(view: WorkbenchView): void }) {
  const { t, locale } = useTranslation(messages), { selectedKnowledgeBase: base, status, scopeKey } = useKnowledgeBaseResources(), { session } = useIdentity(), local = useLocalLibrary();
  const dialog = useRef<HTMLDialogElement>(null), listId = useId();
  const [query, setQuery] = useState(''), [folderId, setFolderId] = useState(''), [authorId, setAuthorId] = useState(''), [selected, setSelected] = useState(0), [debounced, setDebounced] = useState('');
  const normalized = query.trim(), ready = Boolean(base && status === 'ready' && (base.source === 'local' || session.status === 'authenticated')), allowed = normalized.length !== 1;
  const filters = { ...(folderId ? { folderId } : {}), ...(authorId ? { authorId } : {}) };
  const facets = useQuery({ queryKey: [scopeKey, 'discovery-facets'], enabled: ready && base?.source === 'server', queryFn: ({ signal }) => fetchDiscoveryFacets(base!.id, signal) });
  const server = useQuery({ queryKey: [scopeKey, 'discovery-search', debounced, folderId, authorId], enabled: ready && allowed && base?.source === 'server' && debounced === normalized, queryFn: ({ signal }) => searchServerKnowledgeDocuments(base!.id, debounced, signal, filters) });
  const localOptions = useMemo(() => {
    const documents = local.library.documents.filter(document => document.baseId === base?.id && !document.deleted);
    return { folders: local.library.folders.filter(folder => folder.knowledgeBaseId === base?.id), authors: [...new Set(documents.map(document => document.creator ?? '__local__'))].map(id => ({ id, name: id === '__local__' ? t('localAuthor') : id })) };
  }, [local.library, base?.id, t]);
  const options = base?.source === 'local' ? localOptions : facets.data;
  const localOutcome = useMemo(() => base?.source === 'local' ? searchLocalKnowledge(local.library, base, normalized, { folderId: folderId || undefined, authorId: authorId || undefined }) : null, [base, local.library, normalized, folderId, authorId]);
  const pending = ready && allowed && (base?.source === 'server' ? server.isPending || normalized !== debounced : !local.store);
  const failed = base?.source === 'server' ? server.isError : Boolean(local.error);
  const outcome = base?.source === 'local' ? localOutcome : server.data;
  const results = ready && allowed && !pending && !failed ? outcome?.hits ?? [] : [];
  const activeIndex = Math.min(selected, Math.max(0, results.length - 1));
  useEffect(() => { const timer = setTimeout(() => setDebounced(normalized), 180); return () => clearTimeout(timer); }, [normalized]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null, node = dialog.current!;
    node.showModal(); node.querySelector('input')?.focus({ preventScroll: true });
    return () => { node.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => { dialog.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [activeIndex, results.length]);
  function openDocument(hit: KnowledgeSearchHit) { onClose(); onNavigate('knowledge'); requestAnimationFrame(() => requestOpenPageBlock({ knowledgeBaseId: hit.knowledgeBaseId, pageId: hit.pageId, blockId: hit.blockId })); }
  const date = (value?: string) => value ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value)) : '';
  return <dialog ref={dialog} className={styles.dialog} aria-label={t('search')} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <form className={styles.form} onSubmit={event => { event.preventDefault(); if (results[activeIndex]) openDocument(results[activeIndex]); }}>
      <div className={styles.field}><MagnifyingGlass size={20} aria-hidden /><input type="search" role="combobox" maxLength={200} aria-label={t('search')} aria-expanded="true" aria-autocomplete="list" aria-controls={listId} aria-activedescendant={results.length ? `${listId}-${activeIndex}` : undefined} placeholder={t('placeholder')} value={query} onChange={event => { setQuery(event.target.value); setSelected(0); }} onKeyDown={event => { if (['ArrowDown', 'ArrowUp'].includes(event.key) && results.length) { event.preventDefault(); setSelected((activeIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length); } }} /><button type="button" className={`fob-action ${styles.close}`} aria-label={t('close')} onClick={onClose}><X size={16} aria-hidden /></button></div>
      <div className={styles.filters}><SearchFilter label={t('anyFolder')} icon={<Folder size={14} />} value={folderId} options={options?.folders ?? []} disabled={!ready} onChange={value => { setFolderId(value); setSelected(0); }} /><SearchFilter label={t('anyAuthor')} icon={<User size={14} />} value={authorId} options={options?.authors ?? []} disabled={!ready} onChange={value => { setAuthorId(value); setSelected(0); }} />{(folderId || authorId) && <button type="button" className={`fob-action ${styles.clear}`} onClick={() => { setFolderId(''); setAuthorId(''); setSelected(0); }}>{t('clear')}</button>}<span className={styles.scope}>{base?.name}</span></div>
      {facets.isError && base?.source === 'server' && <div className={styles.facetError}><AppAlert tone="error" title={t('failed')} /><Button size="sm" variant="ghost" onClick={() => void facets.refetch()}>{t('retry')}</Button></div>}
      <div className={styles.resultHeading}><span>{normalized || folderId || authorId ? t('results') : t('recent')}</span>{Boolean(results.length) && <span>{t('count', { count: results.length })}</span>}</div>
      <ScrollArea className={styles.results} viewportClassName={styles.resultList} style={{ height: Math.min(400, Math.max(160, results.length * 74 + 12)) }}>
        <div id={listId} role="listbox" aria-label={t('results')} aria-busy={pending}>{results.map((hit, index) => <button key={`${hit.source}:${hit.knowledgeBaseId}:${hit.pageId}`} id={`${listId}-${index}`} type="button" role="option" tabIndex={-1} aria-selected={index === activeIndex} data-highlighted={index === activeIndex ? '' : undefined} className={`fob-menu-item ${styles.result}`} onPointerMove={() => setSelected(index)} onMouseDown={event => event.preventDefault()} onClick={() => openDocument(hit)}><FileText size={18} aria-hidden /><span className={styles.resultText}><span className={styles.label}>{hit.title || t('unknown')}</span>{hit.snippet && <span className={styles.detail}>{hit.snippet}</span>}<span className={styles.metadata}>{[hit.folderName, hit.creatorName ?? (hit.source === 'local' ? t('localAuthor') : ''), date(hit.updatedAt)].filter(Boolean).join(' · ')}</span></span><span className={styles.enter}>↵</span></button>)}</div>
        {!ready ? <p className={styles.empty}>{t('chooseBase')}</p> : !allowed ? <p className={styles.empty}>{t('minimum')}</p> : pending ? <div className={styles.skeleton} role="status" aria-label={t('loading')}><i /><i /><i /></div> : failed ? <div className={styles.empty}><AppAlert tone="error" title={t('failed')} /><Button size="sm" variant="outline" onClick={() => base?.source === 'local' ? window.location.reload() : void server.refetch()}>{t('retry')}</Button></div> : !results.length && <div className={styles.empty}><strong>{t('noResults')}</strong><p>{t('refine')}</p></div>}
      </ScrollArea>
      <footer className={styles.footer}><span>{outcome?.hasMore ? t('limit', { count: results.length }) : base?.source === 'local' ? t('device') : ''}</span><span><kbd>↑↓</kbd>{t('select')}<kbd>↵</kbd>{t('open')}<kbd>Esc</kbd>{t('close')}</span></footer>
    </form>
  </dialog>;
}

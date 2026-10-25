'use client';

import { useEffect, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { createPortal } from 'react-dom';
import { DotsThree, Eye, Folder, LockSimple, MagnifyingGlass, OutlineCollectionIcon, PencilSimple, Plus, ShieldCheck, UploadSimple } from '@/components/icons';
import type { OutlineCollectionGlyph } from '@/components/icons/outline-collection-icon';
import type { DiscoveryDocument, FolderMetadata, FolderOverview, FolderTab } from '@fob/shared/knowledge/contracts';
import type { JSONContent } from '@tiptap/core';
import type { EditorBlockContext } from '../editor/block-modules/types';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DocumentModal } from '../sharing/document-modal';
import { PageIcon } from '../navigation/page-icon';
import { useDocumentTab } from '../editor/document-tab-context';
import { useKnowledgeNavigationActive } from '../navigation/system-navigation';
import { PageIconPicker } from '../navigation/page-icon-picker';
import { FolderSubscriptionMenuItem } from '../subscriptions/subscription-menu-item';
import { useTranslation } from '@/lib/i18n';
import { FolderDocumentMeta } from './folder-document-meta';
import { FolderSortMenu } from './folder-sort-menu';
import type { FolderActions, FolderBulkAction } from './folder-actions';
import { messages } from './messages';
import styles from './discovery.module.css';

const OverviewEditor = dynamic(() => import('./folder-overview-editor').then(module => module.FolderOverviewEditor), { ssr: false });
const tabs: FolderTab[] = ['overview', 'documents', 'popular', 'updated', 'oldest', 'alphabetical'];

export function FolderView({ data, documents, tab, onTab, q, onSearch, onOpen, onCreate, onUpdate, onPermissions, renderMenu, upload, source, more, loadingMore, onMore, actions, viewerId, overview, updating = false }: {
  data: FolderOverview; documents: DiscoveryDocument[]; tab: FolderTab; onTab(value: FolderTab): void; q: string; onSearch(value: string): void; onOpen(id: string): void; onCreate(): void;
  onUpdate(patch: Partial<FolderMetadata> & { name?: string }): Promise<void>; onPermissions?: () => void; renderMenu?: (id: string) => ReactNode; upload?: ReactNode; source: 'local' | 'server'; more?: boolean; loadingMore?: boolean; onMore?(): void;
  actions?: FolderActions; viewerId?: string; updating?: boolean;
  overview?: { draftKey: string; context: EditorBlockContext; save(content: JSONContent, revision: number): Promise<number> };
}) {
  const { t, locale } = useTranslation(messages);
  const navigationActive = useKnowledgeNavigationActive();
  const [modal, setModal] = useState<'rename' | 'import' | 'move' | 'trash' | null>(null);
  const [name, setName] = useState(data.folder.name);
  const [busy, setBusy] = useState(false), [operation, setOperation] = useState<string | null>(null), [error, setError] = useState('');
  const [selection, setSelection] = useState<{ context: string; ids: string[] }>({ context: '', ids: [] });
  const [destination, setDestination] = useState('');
  const [modalIds, setModalIds] = useState<string[]>([]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const reportTitle = useDocumentTab()?.reportTitle;
  useEffect(() => { reportTitle?.(data.folder.name); return () => reportTitle?.(null); }, [data.folder.name, reportTitle]);
  const { folder, canManage, canCreate } = data, pinnedIds = folder.metadata.pinnedPageIds ?? [];
  const listed = tab === 'documents' ? [...documents].sort((left, right) => Number(pinnedIds.includes(right.id)) - Number(pinnedIds.includes(left.id))) : documents;
  const context = `${folder.id}:${tab}:${q}`;
  if (selection.context !== context) setSelection({ context, ids: [] });
  const visible = new Set(tab === 'overview' ? [] : documents.map(document => document.id));
  const selected = selection.context === context ? selection.ids.filter(id => visible.has(id)) : [];
  const allStarred = selected.every(id => actions?.starredIds.includes(id)), allDrafts = selected.every(id => actions?.draftIds.includes(id));
  const allPinned = selected.every(id => pinnedIds.includes(id));
  const clearSelection = () => setSelection({ context, ids: [] });
  useEffect(() => {
    if (!selected.length) return;
    const clear = (event: KeyboardEvent) => { if (event.key === 'Escape' && !modal && !busy) setSelection({ context, ids: [] }); };
    window.addEventListener('keydown', clear);
    return () => window.removeEventListener('keydown', clear);
  }, [selected.length, context, modal, busy]);

  async function update(patch: Partial<FolderMetadata> & { name?: string }, close = false, key: string | null = null) {
    if (busy) return;
    setBusy(true); setOperation(key); setError('');
    try { await onUpdate(patch); if (close) setModal(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setBusy(false); setOperation(null); }
  }
  async function bulk(action: FolderBulkAction) {
    const ids = action === 'move' || action === 'trash' ? modalIds : selected;
    if (!actions || busy || !ids.length) return;
    setBusy(true); setOperation(action); setError('');
    try { await actions.run(action, ids, destination); if (['move', 'trash'].includes(action)) clearSelection(); setModal(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setBusy(false); setOperation(null); }
  }
  function select(id: string, checked: boolean) { setSelection({ context, ids: checked ? [...selected, id] : selected.filter(value => value !== id) }); }
  function tool(label: string, glyph: OutlineCollectionGlyph, onClick: () => void, key: string, disabled = false, pressed?: boolean) {
    return <Tooltip key={key}><TooltipTrigger asChild><Button variant="ghost" size="icon-sm" className={styles.bulkButton} data-surface="plain" aria-label={label} aria-pressed={pressed} data-starred={key === 'star' && pressed} data-active-emphasis={pressed ? 'strong' : undefined} loading={busy && operation === key} disabled={disabled || (busy && operation !== key)} onClick={onClick}><OutlineCollectionIcon name={glyph} /></Button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
  }
  function row(document: DiscoveryDocument, prefix = '') {
    const pinned = pinnedIds.includes(document.id), starred = actions?.starredIds.includes(document.id) ?? false;
    return <div key={`${prefix}${document.id}`} className={`fob-action ${styles.documentRow}`} data-selected={selected.includes(document.id)}>
      <div className={styles.documentGlyph}>
        <span className={styles.documentIcon}>{document.icon ? <PageIcon value={document.icon} size={26} /> : <OutlineCollectionIcon name="document" />}</span>
        <button type="button" className={styles.selectDocument} role="checkbox" aria-checked={selected.includes(document.id)} aria-label={t('selectDocument', { title: document.title || t('unknown') })} onClick={() => select(document.id, !selected.includes(document.id))}>{selected.includes(document.id) && <OutlineCollectionIcon name="checkmark" size={16} />}</button>
      </div>
      <div className={styles.documentText}>
        <div className={styles.documentHeading}><button type="button" className={styles.openDocument} onClick={() => onOpen(document.id)}>{document.title || t('unknown')}</button>{actions && <button type="button" className={`fob-action ${styles.rowStar}`} data-starred={starred} aria-label={t(starred ? 'unstar' : 'star')} aria-pressed={starred} disabled={busy} onClick={() => { setError(''); void actions.run('star', [document.id]).catch(cause => setError(cause instanceof Error ? cause.message : t('failed'))); }}><OutlineCollectionIcon name={starred ? 'starred' : 'unstarred'} size={22} /></button>}</div>
        <button type="button" className={styles.openMeta} tabIndex={-1} onClick={() => onOpen(document.id)}><FolderDocumentMeta document={document} viewerId={viewerId} now={now} /></button>
      </div>
      {tab === 'popular' && <span className={styles.rowMetric}><Eye size={12} />{document.views.toLocaleString(locale)}</span>}
      <div className={styles.rowActions}>{canManage && <Button type="button" variant="ghost" size="icon-sm" className={`${styles.iconButton} ${styles.pinButton}`} data-surface="plain" aria-label={`${t(pinned ? 'unpin' : 'pin')} · ${document.title}`} aria-pressed={pinned} data-active-emphasis={pinned ? 'strong' : undefined} loading={busy && operation === document.id} disabled={busy && operation !== document.id} onClick={() => void update({ pinnedPageIds: pinned ? pinnedIds.filter(id => id !== document.id) : [...pinnedIds, document.id] }, false, document.id)}><OutlineCollectionIcon name="pin" size={20} /></Button>}{renderMenu?.(document.id)}</div>
    </div>;
  }
  return <section className={styles.folder} aria-label={folder.name} data-page-scroll={`folder:${folder.id}:${tab}`} data-selecting={selected.length > 0}>
    <div className={styles.folderToolbar}>
      <label><MagnifyingGlass size={14} /><input type="search" aria-label={t('folderSearch')} placeholder={t('folderSearch')} value={q} onChange={event => onSearch(event.target.value)} /></label>
      <div className={styles.folderActions}>{canCreate && <>{upload && <Button size="sm" variant="outline" onClick={() => setModal('import')}><UploadSimple size={16} />{t('importDocuments')}</Button>}<Button size="sm" variant="outline" onClick={onCreate}><Plus size={16} />{t('newDocument')}</Button></>}
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('options')}><DotsThree size={18} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
          {canManage && <><DropdownMenuItem onSelect={() => onTab('overview')}><PencilSimple size={14} />{t('edit')}</DropdownMenuItem><DropdownMenuItem onSelect={() => { setName(folder.name); setError(''); setModal('rename'); }}>{t('rename')}</DropdownMenuItem>{onPermissions && <DropdownMenuItem onSelect={onPermissions}><ShieldCheck size={14} />{t('permissions')}</DropdownMenuItem>}
            {source === 'server' && <DropdownMenuSeparator />}</>}
          {source === 'server' && <FolderSubscriptionMenuItem folderId={folder.id} />}
        </DropdownMenuContent></DropdownMenu>
      </div>
    </div>
    <div className={styles.folderFrame}><div className={styles.folderContent}>
      <header className={styles.folderHeader}>
        <div className={styles.folderTitle}><div className={styles.folderGlyph}>{canManage ? <PageIconPicker value={folder.metadata.icon} iconSize={34} toggleSelected fallbackIcon={<OutlineCollectionIcon name="collection" size={40} />} onChange={icon => onUpdate({ icon })} /> : folder.metadata.icon ? <PageIcon value={folder.metadata.icon} size={34} /> : <OutlineCollectionIcon name="collection" size={40} />}</div><h1>{folder.name}</h1></div>
        <div className={styles.meta}><span>{source === 'local' ? <Folder size={18} /> : folder.defaultAccess ? <OutlineCollectionIcon name="team" size={18} /> : <LockSimple size={18} />}{t(source === 'local' ? 'device' : folder.defaultAccess ? 'workspace' : 'private')}</span><span className={styles.metaSeparator}>•</span><span>{t('documentCount', { count: data.total })}</span></div>
      </header>
      <div className={styles.tabBar}><div className={styles.tabs} role="tablist" aria-label={folder.name}>{tabs.map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={styles.tab} onClick={() => onTab(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; onTab(tabs[index]); (event.currentTarget.parentElement?.children[index] as HTMLButtonElement)?.focus(); } }}>{t(value)}</button>)}</div>{canManage && tab === 'documents' && <FolderSortMenu value={folder.metadata.sort} disabled={busy || updating} onChange={sort => void update({ sort })} />}</div>
      {error && !modal && <AppAlert tone="error" title={error} />}
      {tab === 'overview' ? overview && <OverviewEditor key={overview.draftKey} content={folder.metadata.description} revision={folder.metadata.revision ?? 0} contentId={folder.id} draftKey={overview.draftKey} context={overview.context} editable={canManage} onSave={overview.save} /> : <><div className={styles.list} role="list" aria-label={t('documents')} aria-busy={updating} onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && event.key === 'a') { event.preventDefault(); setSelection({ context, ids: [...visible] }); } }}>{listed.map(document => row(document))}</div>
        {updating && <span role="status" className="sr-only">{t('loading')}</span>}
        {!documents.length && !updating && <div className={styles.empty}><Folder size={30} /><strong>{q ? t('noResults') : t('noDocuments')}</strong><p>{q ? t('refine') : t('createFirst')}</p>{canCreate && !q && <Button size="sm" variant="outline" onClick={onCreate}>{t('newDocument')}</Button>}</div>}
        {more && <div className={styles.loadMore}><Button size="sm" variant="ghost" loading={loadingMore} onClick={onMore}>{t('more')}</Button></div>}
      </>}
    </div></div>
    {selected.length > 0 && navigationActive && createPortal(<div className={styles.bulkPosition}><div className={styles.bulkBar} role="toolbar" aria-label={t('selectedCount', { count: selected.length })}><span className={styles.selectionCount} aria-live="polite">{t('selectedCount', { count: selected.length })}</span><span className={styles.bulkSeparator} />
      {actions && tool(t(allStarred ? 'unstar' : 'star'), 'starred', () => void bulk('star'), 'star', false, allStarred)}
      {canManage && tool(t(allPinned ? 'unpin' : 'pin'), 'pin', () => void update({ pinnedPageIds: allPinned ? pinnedIds.filter(id => !selected.includes(id)) : [...new Set([...pinnedIds, ...selected])] }, false, 'pin'), 'pin', false, allPinned)}
      {actions?.canWrite && <>{tool(t('move'), 'archive', () => { setModalIds([...selected]); setDestination(actions.folders.find(item => item.id !== folder.id)?.id ?? ''); setError(''); setModal('move'); }, 'move', !actions.folders.some(item => item.id !== folder.id))}{tool(t(allDrafts ? 'undraft' : 'draft'), 'unpublish', () => void bulk('draft'), 'draft')}{tool(t('trash'), 'trash', () => { setModalIds([...selected]); setError(''); setModal('trash'); }, 'trash')}</>}
      <span className={styles.bulkSeparator} />{tool(t('clearSelection'), 'close', clearSelection, 'clear', busy)}
    </div></div>, document.body)}
    {modal && <DocumentModal title={t(modal === 'import' ? 'importDocuments' : modal === 'move' ? 'move' : modal === 'trash' ? 'trashTitle' : 'rename')} onClose={() => { if (!busy) setModal(null); }}>
      {modal === 'import' ? <div className={styles.importBody}>{upload}</div> : modal === 'trash' ? <p className={styles.confirmText}>{t('trashHint', { count: modalIds.length })}</p> : modal === 'move' ? <label className={styles.modalField}>{t('moveHint')}<select autoFocus value={destination} onChange={event => setDestination(event.target.value)}>{actions?.folders.filter(item => item.id !== folder.id).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : <label className={styles.modalField}>{t('title')}<input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>}
      {modal === 'move' && source === 'server' && <p className={styles.confirmText}>{t('movePermissions')}</p>}
      {error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}
      {modal !== 'import' && <div className={styles.modalActions}><Button size="sm" variant="outline" disabled={busy} onClick={() => setModal(null)}>{t('cancel')}</Button><Button size="sm" loading={busy} disabled={modal === 'rename' && !name.trim() || modal === 'move' && !destination} onClick={() => modal === 'move' || modal === 'trash' ? void bulk(modal) : void update({ name: name.trim() }, true)}>{t(modal === 'trash' ? 'trashTitle' : modal === 'move' ? 'move' : 'save')}</Button></div>}
    </DocumentModal>}
  </section>;
}

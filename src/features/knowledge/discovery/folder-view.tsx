'use client';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import dynamic from 'next/dynamic';
import { CaretDown, DotsThree, Eye, FilePlus, Folder, LockSimple, MagnifyingGlass, PencilSimple, PushPin, ShieldCheck, Users } from '@/components/icons';
import type { DiscoveryDocument, FolderMetadata, FolderOverview, FolderTab } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DocumentModal } from '../sharing/document-modal';
import { PageIcon, encodePageIcon } from '../navigation/page-icon';
import { useDocumentTab } from '../editor/document-tab-context';
import { PageIconPicker } from '../navigation/page-icon-picker';
import { renderCheckpointHtml } from '../history/restore';
import { FolderSubscriptionMenuItem } from '../subscriptions/subscription-menu-item';
import { useTranslation } from '@/lib/i18n';
import { messages } from './messages';
import styles from './discovery.module.css';

const DescriptionEditor = dynamic(() => import('./folder-description-editor').then(module => module.FolderDescriptionEditor), { ssr: false });
const tabs: FolderTab[] = ['overview', 'documents', 'popular', 'updated', 'published', 'oldest', 'alphabetical'];
export function FolderView({ data, documents, tab, onTab, q, onSearch, onOpen, onCreate, onUpdate, onPermissions, renderMenu, upload, source, more, loadingMore, onMore }: {
  data: FolderOverview; documents: DiscoveryDocument[]; tab: FolderTab; onTab(value: FolderTab): void; q: string; onSearch(value: string): void; onOpen(id: string): void; onCreate(): void;
  onUpdate(patch: Partial<FolderMetadata> & { name?: string }): Promise<void>; onPermissions?: () => void; renderMenu?: (id: string) => ReactNode; upload?: ReactNode; source: 'local' | 'server'; more?: boolean; loadingMore?: boolean; onMore?(): void;
}) {
  const { t, locale } = useTranslation(messages), [modal, setModal] = useState<'description' | 'rename' | 'import' | null>(null), [draft, setDraft] = useState<unknown>(data.folder.metadata.description), [name, setName] = useState(data.folder.name), [busy, setBusy] = useState(false), [operation, setOperation] = useState<string | null>(null), [error, setError] = useState('');
  const reportTitle = useDocumentTab()?.reportTitle;
  useEffect(() => { reportTitle?.(data.folder.name); return () => reportTitle?.(null); }, [data.folder.name, reportTitle]);
  const { folder, canManage, canCreate } = data, pinnedIds = folder.metadata.pinnedPageIds ?? [];
  const html = useMemo(() => renderCheckpointHtml(folder.metadata.description, knowledgeSchema), [folder.metadata.description]);
  const hasDescription = Boolean(html?.replace(/<[^>]+>/g, '').trim());
  const date = (value: string | null) => value ? new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
  async function update(patch: Partial<FolderMetadata> & { name?: string }, close = false, operation: string | null = null) {
    if (busy) return; setBusy(true); setOperation(operation); setError('');
    try { await onUpdate(patch); if (close) setModal(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setBusy(false); setOperation(null); }
  }
  function editDescription() { setDraft(folder.metadata.description ?? { type: 'doc', content: [{ type: 'paragraph' }] }); setError(''); setModal('description'); }
  function row(document: DiscoveryDocument) {
    const pinned = pinnedIds.includes(document.id);
    return <div key={document.id} className={styles.documentRow}><button type="button" className={`fob-action ${styles.openDocument}`} onClick={() => onOpen(document.id)}><PageIcon value={document.icon} size={20} /><span className={styles.documentText}><strong>{document.title || t('unknown')}</strong><small>{document.creatorName} · {date(tab === 'published' ? document.publishedAt : document.updatedAt)}</small></span></button>{tab === 'popular' && <span className={styles.rowMetric}><Eye size={12} />{document.views.toLocaleString(locale)}</span>}<div className={styles.rowActions}>{canManage && <Button type="button" variant="ghost" size="icon-sm" className={styles.iconButton} aria-label={`${t(pinned ? 'unpin' : 'pin')} · ${document.title}`} aria-pressed={pinned} loading={busy && operation === document.id} disabled={busy && operation !== document.id} onClick={() => void update({ pinnedPageIds: pinned ? pinnedIds.filter(id => id !== document.id) : [...pinnedIds, document.id] }, false, document.id)}><PushPin size={14} /></Button>}{renderMenu?.(document.id)}</div></div>;
  }
  return <section className={styles.folder} aria-label={folder.name} data-page-scroll={`folder:${folder.id}:${tab}`}><div className={styles.folderContent}>
    <div className={styles.folderToolbar}><label><MagnifyingGlass size={14} /><input type="search" aria-label={t('folderSearch')} placeholder={t('folderSearch')} value={q} onChange={event => onSearch(event.target.value)} /></label><div className={styles.folderActions}>{canCreate && <>{upload && <Button size="sm" variant="ghost" onClick={() => setModal('import')}>{t('importDocuments')}</Button>}<Button size="sm" variant="outline" onClick={onCreate}><FilePlus size={14} />{t('newDocument')}</Button></>}<DropdownMenu><DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t('options')}><DotsThree size={18} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">{canManage && <><DropdownMenuItem onSelect={editDescription}><PencilSimple size={14} />{t('edit')}</DropdownMenuItem><DropdownMenuItem onSelect={() => { setName(folder.name); setError(''); setModal('rename'); }}>{t('rename')}</DropdownMenuItem>{onPermissions && <DropdownMenuItem onSelect={onPermissions}><ShieldCheck size={14} />{t('permissions')}</DropdownMenuItem>}{source === 'server' && <DropdownMenuSeparator />}</>}{source === 'server' && <FolderSubscriptionMenuItem folderId={folder.id} />}</DropdownMenuContent></DropdownMenu></div></div>
    <header className={styles.folderHeader}><div className={styles.folderTitle}><div className={styles.folderGlyph}>{canManage ? <PageIconPicker value={folder.metadata.icon ?? encodePageIcon('folder', '#68707a')} onChange={icon => onUpdate({ icon })} /> : folder.metadata.icon ? <PageIcon value={folder.metadata.icon} size={30} /> : <Folder size={30} />}</div><h1>{folder.name}</h1></div><div className={styles.meta}><span>{source === 'local' ? <Folder size={13} /> : folder.defaultAccess ? <Users size={13} /> : <LockSimple size={13} />}{t(source === 'local' ? 'device' : folder.defaultAccess ? 'workspace' : 'private')}</span><i /><span>{t('documentCount', { count: data.total })}</span></div></header>
    <div className={styles.tabs} role="tablist" aria-label={folder.name}>{tabs.map(value => <button key={value} type="button" role="tab" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1} className={styles.tab} onClick={() => onTab(value)} onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) { event.preventDefault(); const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(value) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length; onTab(tabs[index]); (event.currentTarget.parentElement?.children[index] as HTMLButtonElement)?.focus(); } }}>{t(value)}</button>)}</div>
    {error && !modal && <AppAlert tone="error" title={error} />}
    {tab === 'overview' && <>{hasDescription ? <div className={styles.description} dangerouslySetInnerHTML={{ __html: html ?? '' }} /> : canManage && <button type="button" className={`fob-action ${styles.descriptionEmpty}`} onClick={editDescription}><PencilSimple size={16} /><span><strong>{t('descriptionEmpty')}</strong><small>{t('descriptionHint')}</small></span></button>}{data.pinned.length > 0 && <><div className={styles.sectionHeading}><h2>{t('pinned')}</h2></div><div className={styles.list}>{data.pinned.map(row)}</div></>}<div className={styles.sectionHeading}><h2>{t('latest')}</h2><button type="button" className="fob-action" onClick={() => onTab('documents')}>{t('allDocuments')}</button></div></>}
    {tab !== 'overview' && <div className={styles.listHeader}><span>{tab === 'popular' ? t(source === 'local' ? 'deviceViews' : 'views') : t('title')}</span>{canManage && tab === 'documents' && <label>{t('sort')}<select aria-label={t('sort')} value={folder.metadata.sort?.field ?? 'position'} disabled={busy} onChange={event => void update({ sort: { field: event.target.value as 'position', direction: folder.metadata.sort?.direction ?? 'asc' } })}>{(['position', 'title', 'updatedAt', 'createdAt'] as const).map(field => <option key={field} value={field}>{t(field === 'position' ? 'manual' : field)}</option>)}</select><button type="button" className={`fob-action ${styles.iconButton}`} aria-label={t(folder.metadata.sort?.direction === 'desc' ? 'ascending' : 'descending')} onClick={() => void update({ sort: { field: folder.metadata.sort?.field ?? 'position', direction: folder.metadata.sort?.direction === 'desc' ? 'asc' : 'desc' } })}><CaretDown size={12} style={{ transform: folder.metadata.sort?.direction === 'desc' ? 'rotate(180deg)' : undefined }} /></button></label>}</div>}
    <div className={styles.list}>{documents.map(row)}</div>
    {!documents.length && <div className={styles.empty}><Folder size={30} /><strong>{q ? t('noResults') : t('noDocuments')}</strong><p>{q ? t('refine') : t('createFirst')}</p>{canCreate && !q && <Button size="sm" variant="outline" onClick={onCreate}>{t('newDocument')}</Button>}</div>}
    {more && <div className={styles.loadMore}><Button size="sm" variant="ghost" loading={loadingMore} onClick={onMore}>{t('more')}</Button></div>}
    {modal && <DocumentModal wide={modal === 'description'} title={t(modal === 'description' ? 'edit' : modal === 'import' ? 'importDocuments' : 'rename')} onClose={() => { if (!busy) setModal(null); }}>{modal === 'import' ? <div className={styles.importBody}>{upload}</div> : modal === 'description' ? <DescriptionEditor content={draft} onChange={setDraft} /> : <label className={styles.modalField}>{t('title')}<input autoFocus maxLength={120} value={name} onChange={event => setName(event.target.value)} /></label>}{error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}{modal !== 'import' && <div className={styles.modalActions}><Button size="sm" variant="outline" disabled={busy} onClick={() => setModal(null)}>{t('cancel')}</Button><Button size="sm" loading={busy} disabled={modal === 'rename' && !name.trim()} onClick={() => void update(modal === 'description' ? { description: draft } : { name: name.trim() }, true)}>{t('save')}</Button></div>}</DocumentModal>}
  </div></section>;
}

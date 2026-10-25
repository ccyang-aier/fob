'use client';
import { useMemo, useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { FolderMetadata, FolderTab, Teamspace } from '@fob/shared/knowledge/contracts';
import { folderTabSchema } from '@fob/shared/knowledge/contracts';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { useAppAlert } from '@/components/app-alert-provider';
import { usePageSessionState } from '@/lib/page-session-state';
import { useTranslation } from '@/lib/i18n';
import { DocumentModal } from '../sharing/document-modal';
import { knowledgeCatalogClient } from '../data/knowledge-catalog-client';
import { organizationQueryKeys } from '../organization/keys';
import { defaultAccessOptions, defaultAccessRebuildNotice } from '../organization/view-model';
import { useKnowledgeBaseResources } from '../data/knowledge-base-resources';
import { fetchFolderOverview, updateFolderOverview } from './api';
import { FolderView } from './folder-view';
import type { FolderActions, FolderBulkAction } from './folder-actions';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { transferKnowledgePage, recycleKnowledgePage } from '../data/pages-api';
import { useKnowledgePagesQuery } from '../data/pages-queries';
import { messages } from './messages';
import styles from './discovery.module.css';

export function ServerFolderOverview({ knowledgeBaseId, folder, folders, onOpen, onCreate, renderMenu, upload }: { knowledgeBaseId: string; folder: Teamspace; folders: readonly Teamspace[]; onOpen(id: string): void; onCreate(): void; renderMenu?(id: string): ReactNode; upload?: ReactNode }) {
  const { t, locale } = useTranslation(messages), { notify } = useAppAlert(), client = useQueryClient(), { principal } = useKnowledgeBaseResources();
  const [storedTab, setTab] = usePageSessionState<string>(`folder:${folder.id}:tab`, 'overview'), [q, setQ] = useState('');
  const tab: FolderTab = folderTabSchema.safeParse(storedTab).success ? storedTab as FolderTab : 'documents';
  const editorContext = useMemo(() => ({ knowledgeBaseId }), [knowledgeBaseId]);
  const [permissions, setPermissions] = useState(false), [defaultAccess, setDefaultAccess] = useState(folder.defaultAccess), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const { collections, setCollections } = useSidebarCollections(principal, knowledgeBaseId);
  const pages = useKnowledgePagesQuery(knowledgeBaseId);
  const query = useInfiniteQuery({ queryKey: [knowledgeBaseId, 'knowledge', 'pages', 'folder', folder.id, principal, tab, q], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => fetchFolderOverview(knowledgeBaseId, folder.id, tab, q, pageParam, signal), getNextPageParam: last => last.nextOffset ?? undefined });
  const data = query.data?.pages[0];
  async function invalidate() { await Promise.all([client.invalidateQueries({ queryKey: [knowledgeBaseId, 'knowledge', 'pages'] }), client.invalidateQueries({ queryKey: organizationQueryKeys.teamspaces(knowledgeBaseId) })]); }
  async function update(patch: Partial<FolderMetadata> & { name?: string }) {
    if (!data) return;
    await updateFolderOverview(knowledgeBaseId, folder.id, data.folder.metadata.revision ?? 0, patch); await invalidate(); notify('success', t('saved'));
  }
  async function run(action: FolderBulkAction, ids: string[], targetFolder?: string) {
    if (action === 'star' || action === 'draft') {
      const field = action === 'star' ? 'starred' : 'drafts';
      setCollections(current => ({ ...current, [field]: ids.every(id => current[field].includes(id)) ? current[field].filter(id => !ids.includes(id)) : [...new Set([...current[field], ...ids])] }));
    } else {
      if (action === 'move' && !folders.some(item => item.id === targetFolder)) throw new Error(t('noPermission'));
      const selected = new Set(ids), byId = new Map(pages.data?.map(page => [page.id, page]));
      const roots = ids.filter(id => { let parent = byId.get(id)?.parentId; const visited = new Set<string>(); while (parent && !visited.has(parent)) { if (selected.has(parent)) return false; visited.add(parent); parent = byId.get(parent)?.parentId; } return true; });
      try { for (const id of roots) { if (action === 'trash') await recycleKnowledgePage(knowledgeBaseId, { pageId: id }); else await transferKnowledgePage(knowledgeBaseId, { pageId: id, targetTeamspaceId: targetFolder! }); } }
      finally { await invalidate(); }
    }
    notify('success', t('done'));
  }
  async function savePermissions() {
    if (saving) return; setSaving(true); setError('');
    try { await knowledgeCatalogClient.updateTeamspace(knowledgeBaseId, folder.id, { defaultAccess }); await invalidate(); setPermissions(false); notify('success', t('saved')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setSaving(false); }
  }
  if (!data) return <section className={styles.folder}><div className={styles.folderContent}><header className={styles.folderHeader}><h1>{folder.name}</h1></header>{query.isError ? <div className={styles.empty}><AppAlert tone="error" title={query.error.message} /><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <div role="status" aria-label={t('loading')}>{[0, 1, 2].map(value => <div key={value} className={styles.documentRow} />)}</div>}</div></section>;
  const actions: FolderActions = { starredIds: collections.starred, draftIds: collections.drafts, folders, canWrite: data.canCreate, run };
  return <><FolderView key={folder.id} data={data} documents={query.data!.pages.flatMap(page => page.documents)} tab={tab} onTab={setTab} q={q} onSearch={setQ} onOpen={onOpen} onCreate={onCreate} onUpdate={update} onPermissions={() => { setDefaultAccess(data.folder.defaultAccess); setError(''); setPermissions(true); }} renderMenu={renderMenu} upload={upload} source="server" actions={actions} viewerId={principal} overview={{ draftKey: `server:${principal}:${knowledgeBaseId}:${folder.id}`, context: editorContext, save: async (content, expectedRevision) => { const result = await updateFolderOverview(knowledgeBaseId, folder.id, expectedRevision, { description: content }); await invalidate(); return result.revision; } }} more={query.hasNextPage} loadingMore={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
    {query.isRefetchError && <div role="alert" className={styles.error}><AppAlert tone="error" title={t('failed')} /><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div>}
    {permissions && <DocumentModal title={t('permissions')} onClose={() => { if (!saving) setPermissions(false); }}><label className={styles.modalField}>{t('defaultAccess')}<select value={defaultAccess ?? ''} onChange={event => setDefaultAccess((event.target.value || null) as typeof defaultAccess)}>{defaultAccessOptions(locale).map(option => <option key={option.value ?? ''} value={option.value ?? ''}>{option.label}</option>)}</select><small>{defaultAccessRebuildNotice(locale)}</small></label>{error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}<div className={styles.modalActions}><Button size="sm" variant="outline" disabled={saving} onClick={() => setPermissions(false)}>{t('cancel')}</Button><Button size="sm" loading={saving} disabled={defaultAccess === data.folder.defaultAccess} onClick={() => void savePermissions()}>{t('save')}</Button></div></DocumentModal>}
  </>;
}

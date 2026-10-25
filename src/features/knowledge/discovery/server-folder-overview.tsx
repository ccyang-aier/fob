'use client';
import { useState, type ReactNode } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import type { FolderMetadata, FolderTab, Teamspace } from '@fob/shared/knowledge/contracts';
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
import { messages } from './messages';
import styles from './discovery.module.css';

export function ServerFolderOverview({ knowledgeBaseId, folder, onOpen, onCreate, renderMenu, upload }: { knowledgeBaseId: string; folder: Teamspace; onOpen(id: string): void; onCreate(): void; renderMenu?(id: string): ReactNode; upload?: ReactNode }) {
  const { t, locale } = useTranslation(messages), { notify } = useAppAlert(), client = useQueryClient(), { principal } = useKnowledgeBaseResources();
  const [tab, setTab] = usePageSessionState<FolderTab>(`folder:${folder.id}:tab`, 'overview'), [q, setQ] = useState('');
  const [permissions, setPermissions] = useState(false), [defaultAccess, setDefaultAccess] = useState(folder.defaultAccess), [saving, setSaving] = useState(false), [error, setError] = useState('');
  const query = useInfiniteQuery({ queryKey: [knowledgeBaseId, 'knowledge', 'pages', 'folder', folder.id, principal, tab, q], initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => fetchFolderOverview(knowledgeBaseId, folder.id, tab, q, pageParam, signal), getNextPageParam: last => last.nextOffset ?? undefined });
  const data = query.data?.pages[0];
  async function invalidate() { await Promise.all([client.invalidateQueries({ queryKey: [knowledgeBaseId, 'knowledge', 'pages'] }), client.invalidateQueries({ queryKey: organizationQueryKeys.teamspaces(knowledgeBaseId) })]); }
  async function update(patch: Partial<FolderMetadata> & { name?: string }) {
    if (!data) return;
    await updateFolderOverview(knowledgeBaseId, folder.id, data.folder.metadata.revision ?? 0, patch); await invalidate(); notify('success', t('saved'));
  }
  async function savePermissions() {
    if (saving) return; setSaving(true); setError('');
    try { await knowledgeCatalogClient.updateTeamspace(knowledgeBaseId, folder.id, { defaultAccess }); await invalidate(); setPermissions(false); notify('success', t('saved')); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('failed')); }
    finally { setSaving(false); }
  }
  if (!data) return <section className={styles.folder}><div className={styles.folderContent}><header className={styles.folderHeader}><h1>{folder.name}</h1></header>{query.isError ? <div className={styles.empty}><AppAlert tone="error" title={query.error.message} /><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div> : <div role="status" aria-label={t('loading')}>{[0, 1, 2].map(value => <div key={value} className={styles.documentRow} />)}</div>}</div></section>;
  return <><FolderView key={folder.id} data={data} documents={query.data!.pages.flatMap(page => page.documents)} tab={tab} onTab={setTab} q={q} onSearch={setQ} onOpen={onOpen} onCreate={onCreate} onUpdate={update} onPermissions={() => { setDefaultAccess(data.folder.defaultAccess); setError(''); setPermissions(true); }} renderMenu={renderMenu} upload={upload} source="server" more={query.hasNextPage} loadingMore={query.isFetchingNextPage} onMore={() => void query.fetchNextPage()} />
    {query.isRefetchError && <div role="alert" className={styles.error}><AppAlert tone="error" title={t('failed')} /><Button size="sm" variant="outline" onClick={() => void query.refetch()}>{t('retry')}</Button></div>}
    {permissions && <DocumentModal title={t('permissions')} onClose={() => { if (!saving) setPermissions(false); }}><label className={styles.modalField}>{t('defaultAccess')}<select value={defaultAccess ?? ''} onChange={event => setDefaultAccess((event.target.value || null) as typeof defaultAccess)}>{defaultAccessOptions(locale).map(option => <option key={option.value ?? ''} value={option.value ?? ''}>{option.label}</option>)}</select><small>{defaultAccessRebuildNotice(locale)}</small></label>{error && <div className={styles.error}><AppAlert tone="error" title={error} /></div>}<div className={styles.modalActions}><Button size="sm" variant="outline" disabled={saving} onClick={() => setPermissions(false)}>{t('cancel')}</Button><Button size="sm" loading={saving} disabled={defaultAccess === data.folder.defaultAccess} onClick={() => void savePermissions()}>{t('save')}</Button></div></DocumentModal>}
  </>;
}

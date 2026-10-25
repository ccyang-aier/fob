'use client';
import { useState, type ReactNode } from 'react';
import type { DiscoveryDocument, FolderMetadata, FolderOverview, FolderTab } from '@fob/shared/knowledge/contracts';
import type { LocalDocument, LocalLibrary } from '../local/local-library';
import { usePageSessionState } from '@/lib/page-session-state';
import { useTranslation } from '@/lib/i18n';
import { FolderView } from './folder-view';
import { messages } from './messages';

export function LocalFolderOverview({ folder, documents, onOpen, onCreate, onUpdate, renderMenu, upload }: { folder: LocalLibrary['folders'][number]; documents: LocalDocument[]; onOpen(id: string): void; onCreate(): void; onUpdate(patch: Partial<FolderMetadata> & { name?: string }): Promise<void>; renderMenu?(id: string): ReactNode; upload?: ReactNode }) {
  const { t, locale } = useTranslation(messages), [tab, setTab] = usePageSessionState<FolderTab>(`folder:${folder.id}:tab`, 'overview'), [q, setQ] = useState('');
  const all = documents.filter(document => document.folderId === folder.id && !document.deleted), metadata = folder.metadata ?? {};
  const data: FolderOverview = { folder: { id: folder.id, name: folder.name, defaultAccess: null, metadata }, canManage: true, canCreate: true, total: all.length, documents: [], pinned: [], nextOffset: null };
  const items: DiscoveryDocument[] = all.map(document => ({ id: document.id, title: document.title, icon: document.icon ?? null, folderId: folder.id, folderName: folder.name, parentId: null, createdBy: null, creatorName: document.creator ?? t('localAuthor'), createdAt: document.createdAt ?? null, updatedAt: document.updatedAt, publishedAt: document.draft ? null : document.createdAt ?? null, views: document.readCount ?? 0, public: false }));
  data.pinned = (metadata.pinnedPageIds ?? []).flatMap(id => items.filter(document => document.id === id));
  const byTitle = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  const order = metadata.sort ?? { field: 'position', direction: 'asc' };
  const sorted = items.filter(document => document.title.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())).sort((a, b) => {
    const delta = tab === 'popular' ? b.views - a.views : tab === 'alphabetical' ? byTitle.compare(a.title, b.title) : tab === 'published' ? (b.publishedAt ?? '').localeCompare(a.publishedAt ?? '') : tab === 'oldest' ? a.updatedAt.localeCompare(b.updatedAt) : tab === 'updated' || tab === 'overview' ? b.updatedAt.localeCompare(a.updatedAt) : order.field === 'position' ? 0 : (order.field === 'title' ? byTitle.compare(a.title, b.title) : (a[order.field] ?? '').localeCompare(b[order.field] ?? '')) * (order.direction === 'desc' ? -1 : 1);
    return delta || (tab === 'documents' && order.field === 'position' ? 0 : a.id.localeCompare(b.id));
  });
  return <FolderView data={data} documents={tab === 'overview' ? sorted.slice(0, 6) : tab === 'published' ? sorted.filter(document => !all.find(item => item.id === document.id)?.draft) : sorted} tab={tab} onTab={setTab} q={q} onSearch={setQ} onOpen={onOpen} onCreate={onCreate} onUpdate={onUpdate} renderMenu={renderMenu} upload={upload} source="local" />;
}

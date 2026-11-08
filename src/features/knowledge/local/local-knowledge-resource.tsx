'use client';

import { useKnowledgeNavigation, useKnowledgeNavigationActive } from '../navigation/system-navigation';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-knowledge-resource.messages';
/** Local storage is a resource capability, independent of account identity. */

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { updateDocumentNavigation, updateFolderNavigation } from '../navigation/document-navigation-location';
import { subscribeOpenFolderTarget } from '../navigation/open-folder-target';
import { usePageSessionState } from '@/lib/page-session-state';
import { ArrowCounterClockwise } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { CanvasState } from '../canvas-states';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-context';
import { KnowledgeWorkbench } from '../knowledge-workbench';
import { PageTreeSidebar } from '../navigation/tree/page-tree-sidebar';
import { SIDEBAR_MAIN_ITEMS } from '../dense-sidebar/sidebar-navigation';
import { useI18n } from '../dense-sidebar/use-i18n';
import {
  emptyLocalLibrary,
  newLocalDocument,
  type createLocalLibraryStore,
  type LocalDocument,
} from './local-library';
import { LocalFileDocument } from '../documents/previews/file-document-surface';
import { documentFileFormat } from '../documents/previews/file-format';
import { readDocumentIndexStatus, readDocumentSource } from '../documents/document-metadata';
import { LocalDocumentEditor } from './local-document-editor';
import { LocalFolderStatus } from './local-folder-status';
import { getLocalFolderSession } from './local-folder-session';
import { subscribeOpenPageTarget } from '../editor/open-target';
import { LocalLibraryNavigation } from './local-library-navigation';
import { KnowledgeEmptyState } from '../knowledge-empty-state';
import { DocumentsPage } from '../documents/documents-page';
import { DocumentCollectionPage } from '../documents/collection-page';
import { PermanentDeleteDocumentDialog } from '../documents/collection-page/permanent-delete-dialog';
import { LocalFolderOverview } from '../discovery/local-folder-overview';
import { LocalDocumentImport } from '../documents/import/local-document-import';
import { FolderImportDialog } from '../documents/import/folder-import-dialog';
import { moveLocalDocument, moveLocalFolder } from './local-document-operations';
import { messages as dragMessages } from '../navigation/tree/tree-drag.messages';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { DotsThree } from '@/components/icons';
import { useDocumentTab, useTabDocumentSelection, useTabFolderSelection } from '../editor/document-tab-context';

type View = 'all-documents' | 'starred' | 'drafts' | 'trash';
type Store = ReturnType<typeof createLocalLibraryStore>;

type LocalKnowledgeResourceProps = {
  store: Store;
  selectedKnowledgeBaseId: string | null;
  onCreateKnowledgeBase: () => void;
};

export function LocalKnowledgeResource({
  store,
  selectedKnowledgeBaseId,
  onCreateKnowledgeBase,
}: LocalKnowledgeResourceProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  const { t: dragT } = useTranslation(dragMessages);
  const { expand: expandSidebar } = useKnowledgeNavigation();
  const navigationActive = useKnowledgeNavigationActive();

  const library = useSyncExternalStore(store.subscribe, store.getSnapshot, () => emptyLocalLibrary);
  const { session, openSignIn } = useIdentity();
  const { t } = useI18n();
  const base = library.bases.find((item) => item.id === selectedKnowledgeBaseId);
  const knowledgeBaseId = base?.id ?? '';
  const tab = useDocumentTab();
  const tabSearch = tab?.search;
  const [view, setView] = usePageSessionState<View>('view', 'all-documents', { preferInitial: Boolean(new URLSearchParams(tabSearch).get('folder')) });
  const [folderId, setFolderId] = useTabFolderSelection(knowledgeBaseId, 'local');
  const folderEditorContext = useMemo(() => ({ localKnowledgeBaseId: knowledgeBaseId, localPageId: folderId ?? undefined, getLocalPages: () => { const current = store.getSnapshot(); return current.documents.filter(item => !item.deleted).map(item => ({ ...item, knowledgeBaseId: item.baseId, knowledgeBaseName: current.bases.find(base => base.id === item.baseId)?.name })); }, subscribeLocalPages: store.subscribe }), [knowledgeBaseId, folderId, store]);
  const [selectedId, setStoredSelectedId] = useTabDocumentSelection(knowledgeBaseId, 'local');
  const setSelectedId = useCallback((id: string | null) => {
    setStoredSelectedId(id);
    if (navigationActive) updateDocumentNavigation(id ? { knowledgeBaseId, pageId: id, source: 'local' } : null, tabSearch);
  }, [setStoredSelectedId, navigationActive, knowledgeBaseId, tabSearch]);
  const [activeTagId, setActiveTagId] = usePageSessionState<string | null>('tag', null);
  const [creation, setCreation] = useState<'document' | 'folder' | null>(null);
  const [creationParentId, setCreationParentId] = useState<string | null>(null);
  const [importFolderId, setImportFolderId] = useState<string | null>(null);
  const [permanentDeletion, setPermanentDeletion] = useState<{ id: string; title: string; knowledgeBaseId: string } | null>(null);
  const { notify } = useAppAlert();
  useEffect(() => {
    if (!navigationActive || !selectedId) return;
    const current = store.getSnapshot().documents.find(document => document.id === selectedId && document.baseId === knowledgeBaseId && !document.deleted), now = new Date();
    if (!current || (current.lastReadAt && now.getTime() - new Date(current.lastReadAt).getTime() < 30 * 60_000)) return;
    try { store.update(library => ({ ...library, documents: library.documents.map(document => document.id === selectedId && document.baseId === knowledgeBaseId ? { ...document, readCount: (document.readCount ?? 0) + 1, lastReadAt: now.toISOString() } : document) })); }
    catch { notify('error', knowledgeT('readStatisticsSaveFailed')); }
  }, [store, selectedId, knowledgeBaseId, navigationActive, notify, knowledgeT]);
  useEffect(
    () =>
      subscribeOpenPageTarget((target) => {
        if (!navigationActive) return;
        if (target.knowledgeBaseId !== knowledgeBaseId) return;
        const page = store
          .getSnapshot()
          .documents.find(
            (item) =>
              item.baseId === target.knowledgeBaseId && item.id === target.pageId && !item.deleted,
          );
        if (!page) return;
        setSelectedId(page.id);
      }),
    [store, setSelectedId, navigationActive, knowledgeBaseId],
  );
  const documents = library.documents.filter((item) => item.baseId === base?.id);
  const folders = library.folders.filter((folder) => folder.knowledgeBaseId === base?.id);
  const live = documents.filter((item) => !item.deleted);
  const tags = library.tags.filter((tag) => tag.baseId === base?.id);
  const activeTag = tags.find((tag) => tag.id === activeTagId);
  const listed = live.filter((item) =>
    activeTag ? activeTag.pageIds.includes(item.id) : !folderId || item.folderId === folderId,
  );
  const visible = documents.filter((item) =>
    view === 'trash'
      ? item.deleted
      : !item.deleted &&
        (view === 'starred' ? item.starred : view === 'drafts' ? item.draft : true),
  );
  const selected = live.find((item) => item.id === selectedId);
  const selectedFolderName =
    folders.find((folder) => folder.id === selected?.folderId)?.name ?? knowledgeT('unfiled');
  const counts = {
    'all-documents': live.length,
    starred: live.filter((item) => item.starred).length,
    drafts: live.filter((item) => item.draft).length,
    trash: documents.filter((item) => item.deleted).length,
  };
  function write(change: Parameters<Store['update']>[0]) {
    try {
      store.update(change);
      return true;
    } catch {
      notify('error', knowledgeT('localSaveFailedChangesWereNotSavedCheck'));
      return false;
    }
  }
  function updateDocument(id: string, patch: Partial<LocalDocument>) {
    return write((current) => ({
      ...current,
      documents: current.documents.map((item) =>
        item.baseId === knowledgeBaseId && item.id === id
          ? { ...item, ...patch, updatedAt: new Date().toISOString() }
          : item,
      ),
    }));
  }
  function openDocument(id: string) {
    setSelectedId(id);
  }
  const openFolder = useCallback((id: string) => {
    setFolderId(id); setActiveTagId(null); setSelectedId(null); setView('all-documents');
    if (navigationActive) updateFolderNavigation({ knowledgeBaseId, folderId: id, source: 'local' }, tabSearch);
  }, [setFolderId, setActiveTagId, setSelectedId, setView, navigationActive, knowledgeBaseId, tabSearch]);
  useEffect(() => navigationActive ? subscribeOpenFolderTarget(target => {
    if (target.knowledgeBaseId === knowledgeBaseId) openFolder(target.folderId);
  }) : undefined, [navigationActive, knowledgeBaseId, openFolder]);
  function openLibrary(next: View = 'all-documents') {
    setView(next); setSelectedId(null); setFolderId(null); setActiveTagId(null);
    if (navigationActive) updateFolderNavigation({ knowledgeBaseId, folderId: null, source: 'local' }, tabSearch);
  }
  function toggleDocumentTag(tagId: string, documentId: string) {
    write((current) => ({
      ...current,
      tags: current.tags.map((tag) =>
        tag.id === tagId
          ? {
              ...tag,
              pageIds: tag.pageIds.includes(documentId)
                ? tag.pageIds.filter((id) => id !== documentId)
                : [...tag.pageIds, documentId],
            }
          : tag,
      ),
    }));
  }
  const title = SIDEBAR_MAIN_ITEMS.find((item) => item.id === view)?.labelKey;
  return (
    <KnowledgeWorkbench
      documentOpen={Boolean(selected)}
      sidebar={
        <PageTreeSidebar
          treeArea={
            <LocalLibraryNavigation
              hasKnowledgeBase={Boolean(base)}
              view={view}
              counts={counts}
              selectedId={selectedId}
              activeTagId={activeTagId}
              folders={folders}
              documents={live}
              tags={tags}
              onSelectMain={openLibrary}
              onSelectDocument={openDocument}
              selectedFolderId={folderId}
              onSelectFolder={openFolder}
              onCreateFolder={parentId => {
                if (base) { setCreationParentId(parentId ?? null); setCreation('folder'); }
              }}
              onImportFolder={setImportFolderId}
              onMoveNode={move => {
                try {
                  if (move.kind === 'folder') moveLocalFolder(store, { knowledgeBaseId, folderId: move.id }, move.parentId, { missing: dragT('missing'), cycle: dragT('cycle') });
                  else moveLocalDocument(store, { knowledgeBaseId, pageId: move.id }, move.folderId, dragT('missing'));
                } catch (error) {
                  if (error instanceof Error && [dragT('missing'), dragT('cycle')].includes(error.message)) throw error;
                  throw new Error(knowledgeT('localSaveFailedChangesWereNotSavedCheck'));
                }
              }}
              onCreateDocument={() => {
                if (base) setCreation('document');
              }}
              onCreateDocumentInFolder={(id) => {
                setFolderId(id);
                setActiveTagId(null);
                setSelectedId(null);
                setView('all-documents');
                setCreation('document');
              }}
              onRenameFolder={(id, name) =>
                write((current) => ({
                  ...current,
                  folders: current.folders.map((folder) =>
                    folder.id === id && folder.knowledgeBaseId === knowledgeBaseId ? { ...folder, name } : folder,
                  ),
                }))
              }
              onRemoveFolder={(id) => {
                if (folders.some(folder => folder.parentId === id)) { notify('error', knowledgeT('folderHasChildren')); return; }
                if (
                  write((current) => ({
                    ...current,
                    folders: current.folders.filter((folder) => folder.knowledgeBaseId !== knowledgeBaseId || folder.id !== id),
                    documents: current.documents.map((doc) =>
                      doc.folderId === id && doc.baseId === knowledgeBaseId ? { ...doc, folderId: undefined } : doc,
                    ),
                  })) &&
                  folderId === id
                ) openLibrary();
              }}
              onCreateDocumentInTag={(id) => {
                setActiveTagId(id);
                setFolderId(null);
                setSelectedId(null);
                setView('all-documents');
                setCreation('document');
              }}
              onCreateTag={(name) => {
                if (base)
                  write((current) => ({
                    ...current,
                    tags: [
                      ...current.tags,
                      { id: crypto.randomUUID(), baseId: base.id, name, pageIds: [] },
                    ],
                  }));
              }}
              onRenameTag={(id, name) =>
                write((current) => ({
                  ...current,
                  tags: current.tags.map((tag) => (tag.id === id ? { ...tag, name } : tag)),
                }))
              }
              onRemoveTag={(id) => {
                write((current) => ({
                  ...current,
                  tags: current.tags.filter((tag) => tag.id !== id),
                }));
                if (activeTagId === id) setActiveTagId(null);
              }}
            />
          }
        />
      }
      overlays={
        <>
        <LocalCreationDialog
          kind={creation}
          onClose={() => setCreation(null)}
          onCreate={(name) => {
            if (creation === 'folder' && base) {
              if (creationParentId && !folders.some(folder => folder.id === creationParentId)) { notify('error', knowledgeT('folderUnavailable')); return; }
              const id = crypto.randomUUID();
              if (
                !write((current) => ({
                  ...current,
                  folders: [...current.folders, { id, knowledgeBaseId: base.id, name, parentId: creationParentId }],
                }))
              )
                return;
              openFolder(id);
            } else {
              if (!base) return;
              const document = {
                ...newLocalDocument(base.id, name),
                folderId: folderId ?? folders[0]?.id,
              };
              if (
                !write((current) => ({
                  ...current,
                  documents: [...current.documents, document],
                  tags: activeTagId
                    ? current.tags.map((tag) =>
                        tag.id === activeTagId
                          ? { ...tag, pageIds: [...tag.pageIds, document.id] }
                          : tag,
                      )
                    : current.tags,
                }))
              )
                return;
              openDocument(document.id);
            }
            setCreation(null);
          }}
        />
        {importFolderId && folders.some(folder => folder.id === importFolderId) && <FolderImportDialog knowledgeBaseId={knowledgeBaseId} source="local" folder={folders.find(folder => folder.id === importFolderId)!} onClose={() => setImportFolderId(null)} />}
        {permanentDeletion?.knowledgeBaseId === knowledgeBaseId && <PermanentDeleteDocumentDialog
          title={permanentDeletion.title}
          onClose={() => setPermanentDeletion(null)}
          onDelete={() => {
            if (write(current => ({ ...current, documents: current.documents.filter(document => document.baseId !== permanentDeletion.knowledgeBaseId || document.id !== permanentDeletion.id || !document.deleted) }))) setPermanentDeletion(null);
          }}
        />}
        </>
      }
    >
      <LocalFolderStatus knowledgeBaseId={knowledgeBaseId} />
      {!base ? (
        <KnowledgeEmptyState onCreate={onCreateKnowledgeBase} />
      ) : selected ? (
        selected.file ||
        (documentFileFormat(selected.title) &&
          documentFileFormat(selected.title) !== 'markdown' &&
          documentFileFormat(selected.title) !== 'text') ? (
          <LocalFileDocument
            key={selected.id}
            knowledgeBaseId={knowledgeBaseId}
            document={selected}
            folderName={selectedFolderName}
            onChange={(patch) => updateDocument(selected.id, patch)}
            onBack={() => setSelectedId(null)}
            onOpenSidebar={expandSidebar}
            onCreateDocument={() => setCreation('document')}
            attach={(setFile) => (
              <LocalDocumentImport
                binaryOnly
                knowledgeBaseId={knowledgeBaseId}
                onImport={(items) => {
                  return items[0]?.file ? setFile(items[0].file) : false;
                }}
              />
            )}
          />
        ) : (
          <LocalDocumentEditor
            key={selected.id}
            knowledgeBaseId={knowledgeBaseId}
            store={store}
            document={selected}
            folderName={selectedFolderName}
            onChange={(patch) => updateDocument(selected.id, patch)}
            onBack={() => {
              setSelectedId(null);
            }}
            onOpenSidebar={expandSidebar}
            onCreateDocument={() => setCreation('document')}
          />
        )
      ) : view === 'all-documents' && folderId && !folders.some(folder => folder.id === folderId) ? <CanvasState title={knowledgeT('folderUnavailable')} actions={<Button variant="outline" onClick={() => openLibrary()}>{knowledgeT('returnToDocuments')}</Button>} /> : view === 'all-documents' && folderId && folders.some(folder => folder.id === folderId) ? <LocalFolderOverview key={folderId} folder={folders.find(folder => folder.id === folderId)!} documents={live} actions={{
        starredIds: live.filter(item => item.starred).map(item => item.id), draftIds: live.filter(item => item.draft).map(item => item.id), folders, canWrite: true,
        run: async (action, ids, destination) => {
          if (action === 'move' && !folders.some(item => item.id === destination)) throw new Error(knowledgeT('folderUnavailable'));
          const selected = live.filter(item => ids.includes(item.id));
          const remove = action === 'star' ? selected.every(item => item.starred) : selected.every(item => item.draft);
          if (!write(current => ({ ...current, documents: current.documents.map(item => item.baseId === base.id && ids.includes(item.id) ? { ...item, ...(action === 'star' ? { starred: !remove } : action === 'draft' ? { draft: !remove } : action === 'move' ? { folderId: destination } : { deleted: true }) } : item) }))) throw new Error(knowledgeT('localSaveFailedChangesWereNotSavedCheck'));
          await getLocalFolderSession().flush(knowledgeBaseId);
        },
      }} editorContext={folderEditorContext} onOpen={openDocument} onOpenFolder={openFolder} childFolders={folders.filter(child => child.parentId === folderId).map(child => ({ id: child.id, name: child.name, icon: child.metadata?.icon }))} onCreateFolder={() => { setCreationParentId(folderId); setCreation('folder'); }} onCreate={() => setCreation('document')} onUpdate={async ({ name, ...patch }) => {
        if (!write(current => ({ ...current, folders: current.folders.map(folder => folder.id === folderId ? { ...folder, ...(name ? { name } : {}), metadata: { ...folder.metadata, ...patch, revision: (folder.metadata?.revision ?? 0) + 1 } } : folder) }))) throw new Error(knowledgeT('localSaveFailedChangesWereNotSavedCheck'));
        await getLocalFolderSession().flush(knowledgeBaseId);
        return store.getSnapshot().folders.find(folder => folder.id === folderId)?.metadata?.revision ?? 0;
      }} upload={<LocalDocumentImport knowledgeBaseId={knowledgeBaseId} onImport={items => write(current => ({ ...current, documents: [...current.documents, ...items.map(item => ({ ...newLocalDocument(base.id, item.name), folderId, file: item.file, body: item.body ?? { type: 'doc', content: item.text.split(/\r?\n/).map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) } }))] }))} />} renderMenu={id => <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="fob-action rounded p-2" aria-label={knowledgeT('documentActions')}><DotsThree size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openDocument(id)}>{knowledgeT('openEdit')}</DropdownMenuItem><DropdownMenuItem onSelect={() => { const item = live.find(document => document.id === id); if (item) updateDocument(id, { starred: !item.starred }); }}>{knowledgeT('toggleStar')}</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => updateDocument(id, { deleted: true })}>{knowledgeT('moveToTrash')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /> : view === 'all-documents' ? (
        <DocumentsPage
          key={`${base.id}:${folderId ?? activeTagId ?? 'all'}`}
          documents={listed.map((item) => ({
            id: item.id,
            title: item.title,
            icon: item.icon,
            updatedAt: item.updatedAt,
            creator: item.creator ?? knowledgeT('me'),
            source: readDocumentSource(item.source, item.file ? 'local-upload' : 'local-document'),
            status: readDocumentIndexStatus(item.indexStatus),
            starred: item.starred,
            folderId: item.folderId,
          }))}
          folders={
            activeTagId
              ? []
              : folders.map((folder) => ({
                  id: folder.id,
                  name: folder.name,
                  count: live.filter((item) => item.folderId === folder.id).length,
                  updatedAt: live
                    .filter((item) => item.folderId === folder.id)
                    .map((item) => item.updatedAt)
                    .sort()
                    .at(-1),
                }))
          }
          onOpen={openDocument}
          onOpenFolder={openFolder}
          onCreate={() => setCreation('document')}
          onCreateFolder={() => { setCreationParentId(null); setCreation('folder'); }}
          onCreateSubfolder={id => { setCreationParentId(id); setCreation('folder'); }}
          onImportFolder={setImportFolderId}
          upload={
            <LocalDocumentImport
              knowledgeBaseId={knowledgeBaseId}
              onImport={(items) =>
                write((current) => ({
                  ...current,
                  documents: [
                    ...current.documents,
                    ...items.map((item) => ({
                      ...newLocalDocument(base.id, item.name),
                      folderId: folderId ?? folders[0]?.id,
                      file: item.file,
                      body: item.body ?? {
                        type: 'doc',
                        content: item.text.split(/\r?\n/).map((text) => ({
                          type: 'paragraph',
                          ...(text ? { content: [{ type: 'text', text }] } : {}),
                        })),
                      },
                    })),
                  ],
                }))
              }
            />
          }
          renderMenu={(id) => (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={knowledgeT('documentActions')}
                  className="p-2 text-slate-500"
                >
                  <DotsThree size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => openDocument(id)}>
                  {knowledgeT('openEdit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const item = live.find((doc) => doc.id === id);
                    if (item) updateDocument(id, { starred: !item.starred });
                  }}
                >
                  {knowledgeT('toggleStar')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    const item = live.find((doc) => doc.id === id);
                    if (item) updateDocument(id, { draft: !item.draft });
                  }}
                >
                  {knowledgeT('toggleDraft')}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>{knowledgeT('tags')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {tags.length ? (
                      tags.map((tag) => (
                        <DropdownMenuCheckboxItem
                          key={tag.id}
                          checked={tag.pageIds.includes(id)}
                          onCheckedChange={() => toggleDocumentTag(tag.id, id)}
                        >
                          {tag.name}
                        </DropdownMenuCheckboxItem>
                      ))
                    ) : (
                      <DropdownMenuItem disabled>{knowledgeT('noTags')}</DropdownMenuItem>
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => updateDocument(id, { deleted: true })}
                >
                  {knowledgeT('moveToTrash')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        />
      ) : (
        <DocumentCollectionPage
          key={`${base.id}:${view}`}
          title={title ? t(title) : knowledgeT('document')}
          kind={view}
          entries={visible.map(item => ({ id: item.id, title: item.title || knowledgeT('untitledDocument'), icon: item.icon, folderId: item.folderId, creator: item.creator, date: item.updatedAt }))}
          folders={folders}
          onOpen={openDocument}
          onCreate={view !== 'trash' ? () => setCreation('document') : undefined}
          onRemove={view === 'starred' ? id => updateDocument(id, { starred: false }) : view === 'drafts' ? id => updateDocument(id, { draft: false }) : undefined}
          renderActions={id => view === 'trash' ? <>
            <Button size="sm" variant="ghost" aria-label={`${knowledgeT('restore')} ${visible.find(item => item.id === id)?.title ?? ''}`} onClick={() => updateDocument(id, { deleted: false })}><ArrowCounterClockwise size={14} />{knowledgeT('restore')}</Button>
            <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="fob-action rounded p-2" aria-label={knowledgeT('documentActions')}><DotsThree size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem variant="destructive" onSelect={() => { const item = visible.find(document => document.id === id); if (item) setPermanentDeletion({ id, title: item.title, knowledgeBaseId }); }}>{knowledgeT('deletePermanently')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </> : <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="fob-action rounded p-2" aria-label={knowledgeT('documentActions')}><DotsThree size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => openDocument(id)}>{knowledgeT('openEdit')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { const item = live.find(document => document.id === id); if (item) updateDocument(id, { starred: !item.starred }); }}>{knowledgeT('toggleStar')}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => { const item = live.find(document => document.id === id); if (item) updateDocument(id, { draft: !item.draft }); }}>{knowledgeT('toggleDraft')}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={() => updateDocument(id, { deleted: true })}>{knowledgeT('moveToTrash')}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>}
          notice={session.status === 'error' ? <AppAlert tone="error" title={knowledgeT('accountServiceUnavailableLocalKnowledgeBasesRemainAvailable')} className="mb-4" action={<Button size="sm" onClick={openSignIn}>{knowledgeT('signInRetry')}</Button>} /> : undefined}
          footer={knowledgeT('localDocumentsAreStoredOnlyInThisBrowser')}
        />
      )}
    </KnowledgeWorkbench>
  );
}

function LocalCreationDialog({
  kind,
  onClose,
  onCreate,
}: {
  kind: 'document' | 'folder' | null;
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  useEffect(() => {
    if (kind) dialog.current?.showModal();
    else dialog.current?.close();
  }, [kind]);
  return (
    <dialog
      ref={dialog}
      aria-label={kind === 'folder' ? knowledgeT('newFolder') : knowledgeT('newLocalDocument')}
      onCancel={onClose}
      onClose={onClose}
      className="m-auto w-[400px] max-w-[calc(100vw-32px)] rounded-2xl border border-[var(--line)] bg-[var(--panel)] p-7 text-[var(--ink)] shadow-xl backdrop:bg-black/25 backdrop:backdrop-blur-sm"
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) {
            onCreate(name.trim());
            setName('');
          }
        }}
      >
        <h2 className="mb-5 text-base font-semibold">
          {kind === 'folder' ? knowledgeT('newFolder') : knowledgeT('newDocument')}
        </h2>
        <label className="block text-xs">
          {knowledgeT('name')}
          <input
            autoFocus
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-2 h-10 w-full rounded-lg border border-[var(--line)] bg-transparent px-3 outline-none focus:border-[var(--accent)]"
          />
        </label>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setName('');
              onClose();
            }}
          >
            {knowledgeT('cancel')}
          </Button>
          <Button type="submit" disabled={!name.trim()}>
            {knowledgeT('create')}
          </Button>
        </div>
      </form>
    </dialog>
  );
}

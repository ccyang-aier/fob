'use client';

import { useKnowledgeNavigation, useKnowledgeNavigationActive } from '../navigation/system-navigation';

import { formatDate, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './local-knowledge-resource.messages';
/** Local storage is a resource capability, independent of account identity. */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { updateDocumentNavigation, updateFolderNavigation } from '../navigation/document-navigation-location';
import { usePageSessionState } from '@/lib/page-session-state';
import { FilePlus } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { AppAlert } from '@/components/app-alert';
import { CanvasState } from '../canvas-states';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-provider';
import { KnowledgeWorkbench } from '../knowledge-workbench';
import { PageTreeSidebar } from '../navigation/page-tree-sidebar';
import { SIDEBAR_MAIN_ITEMS } from '../dense-sidebar/sidebar-navigation';
import { useI18n } from '../dense-sidebar/use-i18n';
import {
  emptyLocalLibrary,
  newLocalDocument,
  type createLocalLibraryStore,
  type LocalDocument,
} from './local-library';
import { LocalFileDocument } from '../documents/file-document-surface';
import { documentFileFormat } from '../documents/file-format';
import { readDocumentIndexStatus, readDocumentSource } from '../documents/document-metadata';
import { LocalDocumentEditor } from './local-document-editor';
import { subscribeOpenPageTarget } from '../editor/open-target';
import { LocalLibraryNavigation } from './local-library-navigation';
import { KnowledgeEmptyState } from '../knowledge-empty-state';
import { DocumentsPage } from '../documents/documents-page';
import { LocalFolderOverview } from '../discovery/local-folder-overview';
import { LocalDocumentImport } from '../documents/local-document-import';
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
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
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
  const [selectedId, setStoredSelectedId] = useTabDocumentSelection(knowledgeBaseId, 'local');
  const setSelectedId = useCallback((id: string | null) => {
    setStoredSelectedId(id);
    if (navigationActive) updateDocumentNavigation(id ? { knowledgeBaseId, pageId: id, source: 'local' } : null, tabSearch);
  }, [setStoredSelectedId, navigationActive, knowledgeBaseId, tabSearch]);
  const [activeTagId, setActiveTagId] = usePageSessionState<string | null>('tag', null);
  const [creation, setCreation] = useState<'document' | 'folder' | null>(null);
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
  function openFolder(id: string) {
    setFolderId(id); setActiveTagId(null); setSelectedId(null); setView('all-documents');
    if (navigationActive) updateFolderNavigation({ knowledgeBaseId, folderId: id, source: 'local' }, tabSearch);
  }
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
              onCreateFolder={() => {
                if (base) setCreation('folder');
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
                    folder.id === id ? { ...folder, name } : folder,
                  ),
                }))
              }
              onRemoveFolder={(id) => {
                if (
                  write((current) => ({
                    ...current,
                    folders: current.folders.filter((folder) => folder.id !== id),
                    documents: current.documents.map((doc) =>
                      doc.folderId === id ? { ...doc, folderId: undefined } : doc,
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
        <LocalCreationDialog
          kind={creation}
          onClose={() => setCreation(null)}
          onCreate={(name) => {
            if (creation === 'folder' && base) {
              const id = crypto.randomUUID();
              if (
                !write((current) => ({
                  ...current,
                  folders: [...current.folders, { id, knowledgeBaseId: base.id, name }],
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
      }
    >
      {!base ? (
        <KnowledgeEmptyState onCreate={onCreateKnowledgeBase} />
      ) : selected ? (
        selected.file ||
        (documentFileFormat(selected.title) &&
          documentFileFormat(selected.title) !== 'markdown') ? (
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
                knowledgeBaseId={knowledgeBaseId}
                onImport={(items) => {
                  return items[0] ? setFile(items[0].file) : false;
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
      ) : view === 'all-documents' && folderId && !folders.some(folder => folder.id === folderId) ? <CanvasState title={knowledgeT('folderUnavailable')} actions={<Button variant="outline" onClick={() => openLibrary()}>{knowledgeT('returnToDocuments')}</Button>} /> : view === 'all-documents' && folderId && folders.some(folder => folder.id === folderId) ? <LocalFolderOverview key={folderId} folder={folders.find(folder => folder.id === folderId)!} documents={live} onOpen={openDocument} onCreate={() => setCreation('document')} onUpdate={async ({ name, ...patch }) => {
        if (!write(current => ({ ...current, folders: current.folders.map(folder => folder.id === folderId ? { ...folder, ...(name ? { name } : {}), metadata: { ...folder.metadata, ...patch, revision: (folder.metadata?.revision ?? 0) + 1 } } : folder) }))) throw new Error(knowledgeT('localSaveFailedChangesWereNotSavedCheck'));
      }} upload={<LocalDocumentImport knowledgeBaseId={knowledgeBaseId} onImport={items => write(current => ({ ...current, documents: [...current.documents, ...items.map(item => ({ ...newLocalDocument(base.id, item.name), folderId, file: item.file, body: { type: 'doc', content: item.text.split(/\r?\n/).map(text => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) })) } }))] }))} />} renderMenu={id => <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="fob-action rounded p-2" aria-label={knowledgeT('documentActions')}><DotsThree size={16} /></button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => openDocument(id)}>{knowledgeT('openEdit')}</DropdownMenuItem><DropdownMenuItem onSelect={() => { const item = live.find(document => document.id === id); if (item) updateDocument(id, { starred: !item.starred }); }}>{knowledgeT('toggleStar')}</DropdownMenuItem><DropdownMenuItem variant="destructive" onSelect={() => updateDocument(id, { deleted: true })}>{knowledgeT('moveToTrash')}</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} /> : view === 'all-documents' ? (
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
          onCreateFolder={() => setCreation('folder')}
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
                      body: {
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
        <section className="h-full overflow-auto px-8 py-12 sm:px-14">
          <div className="mx-auto max-w-[860px]">
            <p className="mb-4 text-xs text-[var(--muted)]">
              {base?.name}{' '}
              <span className="ml-2 rounded-full bg-[var(--surface-subtle)] px-2 py-1 text-[10px]">
                {knowledgeT('localPersonal')}
              </span>
            </p>
            <div className="mb-7 flex items-center justify-between">
              <h1 className="text-[26px] font-semibold tracking-tight">
                {title ? t(title) : knowledgeT('document')}
              </h1>
              {view !== 'trash' ? (
                <Button size="sm" variant="outline" onClick={() => setCreation('document')}>
                  <FilePlus size={14} />
                  {knowledgeT('newDocument')}
                </Button>
              ) : null}
            </div>
            <p className="mb-6 text-xs leading-6 text-[var(--muted)]">
              {knowledgeT('localDocumentsAreStoredOnlyInThisBrowser')}
            </p>
            {session.status === 'error' ? (
              <AppAlert
                tone="error"
                title={knowledgeT('accountServiceUnavailableLocalKnowledgeBasesRemainAvailable')}
                className="mb-4"
                action={
                  <Button size="sm" onClick={openSignIn}>
                    {knowledgeT('signInRetry')}
                  </Button>
                }
              />
            ) : null}
            <div className="overflow-hidden rounded-xl border border-[var(--line)]">
              {visible.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3 last:border-0 hover:bg-[var(--surface-hover)]"
                >
                  <button
                    type="button"
                    disabled={item.deleted}
                    onClick={() => openDocument(item.id)}
                    className="min-w-0 flex-1 truncate text-left text-xs"
                  >
                    {item.title || knowledgeT('untitledDocument')}
                  </button>
                  {item.deleted ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => updateDocument(item.id, { deleted: false })}
                      >
                        {knowledgeT('restore')}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          write((current) => ({
                            ...current,
                            documents: current.documents.filter((doc) => doc.id !== item.id),
                          }))
                        }
                      >
                        {knowledgeT('deletePermanently')}
                      </Button>
                    </>
                  ) : (
                    <span className="text-[10px] text-[var(--muted)]">
                      {formatDate(item.updatedAt, undefined, locale)}
                    </span>
                  )}
                </div>
              ))}
              {!visible.length ? (
                <div className="py-12 text-center text-xs text-[var(--muted)]">
                  {view === 'trash' ? knowledgeT('trashIsEmpty') : knowledgeT('noDocumentsYet')}
                </div>
              ) : null}
            </div>
          </div>
        </section>
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

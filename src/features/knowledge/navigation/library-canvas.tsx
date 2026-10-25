'use client';

import { formatDate, createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './library-canvas.messages';
import { useMemo } from 'react';
import { usePageScrollKey } from '@/lib/page-session-state';
import { DocumentsPage } from '../documents/documents-page';
import { KnowledgeBaseDocumentImport } from '../documents/server-document-import';
import { FilePlus, Folder, Plus } from '@phosphor-icons/react';
import type { Teamspace } from '@fob/shared/knowledge/contracts';
import type { KnowledgeAccess } from '../data/hooks';
import { useKnowledgePagesQuery } from '../data/pages-queries';
import { SidebarDocumentMenu } from '../dense-sidebar/sidebar-document-menu';
import { CanvasError, CanvasSpinner } from '../canvas-states';
import { buildNavigationSections, pageDisplayTitle, recycledRootPages } from './tree-model';
import { readDocumentIndexStatus, readDocumentSource } from '../documents/document-metadata';
import { sidebarDocuments } from './sidebar-documents';
import { useSidebarCollections } from './sidebar-collections';
import { useDocumentNavigationActions } from './document-navigation-actions';
import { canEditTree } from './tree-actions';
import type { TreeNotifier } from './page-operations';
import type { LibraryView } from './tree-stage';
import styles from '../library-canvas.module.css';

function titles(locale?: Locale) {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return {
    overview: knowledgeT('knowledgeBase'),
    'all-documents': knowledgeT('document'),
    starred: knowledgeT('starred'),
    drafts: knowledgeT('drafts'),
    trash: knowledgeT('trash'),
    projects: knowledgeT('folder'),
    recent: knowledgeT('recent'),
  };
}

export function LibraryCanvas({
  knowledgeBaseId,
  userId,
  name,
  view,
  access,
  teamspaces,
  onOpenPage,
  onSelectFolder,
  onCreateFolder,
  notify,
  folder,
  onExpandSidebar,
}: {
  knowledgeBaseId: string;
  userId: string;
  name: string;
  view: LibraryView;
  access: KnowledgeAccess | undefined;
  teamspaces: readonly Teamspace[];
  onOpenPage: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onCreateFolder: () => void;
  notify: TreeNotifier;
  folder?: Teamspace | null;
  onExpandSidebar?: () => void;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const scrollKey = usePageScrollKey(`library:${view}:${folder?.id ?? ''}`);

  const query = useKnowledgePagesQuery(knowledgeBaseId);
  const pages = useMemo(() => {
    const folderIds = new Set(teamspaces.map((folder) => folder.id));
    return (query.data ?? []).filter((page) => folderIds.has(page.teamspaceId));
  }, [query.data, teamspaces]);
  const documents = sidebarDocuments(buildNavigationSections(teamspaces, pages, locale), pages);
  const { collections } = useSidebarCollections(userId, knowledgeBaseId);
  const actions = useDocumentNavigationActions({
    knowledgeBaseId,
    userId,
    pages,
    teamspaces,
    canEdit: canEditTree(access),
    onOpenPage,
    notify,
  });
  const listed =
    view === 'overview' && folder
      ? documents.filter((page) => page.teamspaceId === folder.id)
      : view === 'starred'
        ? documents.filter((page) => collections.starred.includes(page.id))
        : view === 'drafts'
          ? documents.filter((page) => collections.drafts.includes(page.id))
          : view === 'recent'
            ? documents.slice(0, 10)
            : documents;
  if (query.isPending) return <CanvasSpinner label={knowledgeT('loadingDocuments')} />;
  if (query.isError)
    return (
      <CanvasError
        title={knowledgeT('unableToLoadDocuments')}
        onRetry={() => void query.refetch()}
      />
    );
  const recycled = recycledRootPages(pages);
  if (view === 'all-documents')
    return (
      <>
        <DocumentsPage
          onExpandSidebar={onExpandSidebar}
          documents={documents.map((page) => ({
            id: page.id,
            title: pageDisplayTitle(page, locale),
            icon: page.icon,
            updatedAt: page.updatedAt,
            creator:
              typeof page.properties?.displayCreator === 'string'
                ? page.properties.displayCreator
                : page.createdBy === userId
                  ? knowledgeT('me')
                  : knowledgeT('members'),
            source: readDocumentSource(page.properties?.fileSource, 'knowledge-base'),
            status: readDocumentIndexStatus(page.properties?.indexStatus),
            folderId: page.teamspaceId,
            starred: collections.starred.includes(page.id),
          }))}
          folders={teamspaces.map((space) => ({
            id: space.id,
            name: space.name,
            count: documents.filter((page) => page.teamspaceId === space.id).length,
            updatedAt: documents
              .filter((page) => page.teamspaceId === space.id)
              .map((page) => page.updatedAt)
              .sort()
              .at(-1),
          }))}
          onOpen={onOpenPage}
          onOpenFolder={onSelectFolder}
          onCreate={() => void actions.create()}
          onCreateFolder={onCreateFolder}
          canEdit={canEditTree(access)}
          upload={
            <KnowledgeBaseDocumentImport
              knowledgeBaseId={knowledgeBaseId}
              teamspaceId={folder?.id ?? teamspaces[0]?.id ?? null}
            />
          }
          renderMenu={(id) => (
            <SidebarDocumentMenu
              documentId={id}
              starred={collections.starred.includes(id)}
              onAction={actions.act}
            />
          )}
        />
        {actions.dialogs}
      </>
    );
  return (
    <section
      aria-label={knowledgeT('knowledgeBaseDocuments')}
      className="min-h-0 flex-1 overflow-y-auto bg-[var(--panel)]"
      data-page-scroll={scrollKey}
    >
      <div className={styles.libraryView}>
        <header className={styles.viewHeader}>
          <div>
            <p className={styles.eyebrow}>{name}</p>
            <h1>{view === 'overview' ? (folder?.name ?? name) : titles(locale)[view]}</h1>
          </div>
          {view !== 'trash' ? (
            <button
              type="button"
              className={styles.primaryAction}
              onClick={() =>
                view === 'projects' ? onCreateFolder() : void actions.create(folder?.id)
              }
            >
              {view === 'projects' ? <Plus size={15} /> : <FilePlus size={15} />}
              {view === 'projects' ? knowledgeT('newFolder') : knowledgeT('newDocument')}
            </button>
          ) : null}
        </header>
        <div className={styles.documentList}>
          {view === 'projects'
            ? teamspaces.map((folder) => (
                <button
                  key={folder.id}
                  type="button"
                  className={styles.folderRow}
                  onClick={() => onSelectFolder(folder.id)}
                >
                  <Folder size={16} />
                  <span>{folder.name}</span>
                </button>
              ))
            : view === 'trash'
              ? recycled.map((page) => (
                  <div key={page.id} className={styles.documentCard}>
                    <span className="min-w-0 flex-1 truncate px-4 py-3 text-[13px]">
                      {page.title}
                    </span>
                    <button
                      type="button"
                      aria-label={knowledgeT('restoreValue', { v0: page.title })}
                      disabled={actions.operations.hasPending(page.id)}
                      onClick={() => void actions.operations.restorePage(page.id)}
                      className="!w-auto px-4 text-[12px]"
                    >
                      {knowledgeT('restore')}
                    </button>
                  </div>
                ))
              : listed.map((page) => (
                  <div key={page.id} className={styles.documentCard}>
                    <button type="button" onClick={() => onOpenPage(page.id)}>
                      <span>{pageDisplayTitle(page, locale)}</span>
                      <small>
                        {formatDate(page.updatedAt, { month: 'short', day: 'numeric' }, locale)}
                      </small>
                    </button>
                    <SidebarDocumentMenu
                      documentId={page.id}
                      starred={collections.starred.includes(page.id)}
                      onAction={actions.act}
                    />
                  </div>
                ))}
          {(
            view === 'projects'
              ? !teamspaces.length
              : view === 'trash'
                ? !recycled.length
                : !listed.length
          ) ? (
            <p className={styles.empty}>
              {view === 'trash' ? knowledgeT('trashIsEmpty') : knowledgeT('noContentHereYet')}
            </p>
          ) : null}
        </div>
      </div>
      {actions.dialogs}
    </section>
  );
}

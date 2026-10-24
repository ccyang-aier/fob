'use client';

import { createTranslator, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './knowledge-page.messages';

/** Identity controls access; each knowledge base owns its resource scope. */

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PageSessionNamespace, usePageSessionState } from '@/lib/page-session-state';
import { useQueryClient } from '@tanstack/react-query';
import { LockSimple, XCircle } from '@phosphor-icons/react';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/features/identity/identity-provider';
import { useProjectResources } from '@/features/project/project-resources';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { authErrorCopyFor } from '../identity/auth-errors';
import {
  connectKnowledgeBaseEvents,
  type KnowledgeBaseEvents,
} from './collaboration/knowledge-base-events';
import { CanvasError, CanvasSpinner, CanvasState } from './canvas-states';
import { useKnowledgeAccessQuery } from './data/hooks';
import { knowledgeKeysForSegments, knowledgeBaseRootKey } from './data/invalidation';
import { KnowledgeQueryProvider } from './data/provider';
import { invalidateKnowledgeQueries } from './data/query-client';
import {
  flattenKnowledgeBaseList,
  useKnowledgeTeamspacesQuery,
} from './data/catalog-queries';
import {
  deriveKnowledgeEntryPhase,
  knowledgeErrorCodeOf,
  type KnowledgeQuerySlice,
} from './entry-state';
import { useKnowledgeNotificationsBridge } from './notifications/notifications-queries';
import { subscribeOpenPageTarget } from './editor/open-target';
import {
  KnowledgeTreeStage,
  type TreeStageTeamspaceState,
  type LibraryView,
} from './navigation/tree-stage';
import { CreateTeamspaceDialog } from './navigation/create-teamspace-dialog';
import { PageTreeSidebar } from './navigation/page-tree-sidebar';
import { organizationErrorTextOf } from './organization/errors';
import { useAppAlert } from '@/components/app-alert-provider';
import { CreateKnowledgeBaseDialog } from './organization/create-knowledge-base-dialog';
import { LibraryCanvas } from './navigation/library-canvas';
import { KnowledgePageEditor } from './editor';
import { KnowledgeWorkbench } from './knowledge-workbench';
import { useKnowledgeBaseSelection } from './use-knowledge-base-selection';
import { CreateDocumentDialog, type DocumentCreation } from './navigation/create-document-dialog';
import { NavigationDialogPortal } from './navigation/navigation-dialog-portal';
import { usePageTreeOperations } from './navigation/page-operations';
import { canEditTree } from './navigation/tree-actions';
import { useCreateTeamspaceMutation } from './organization/hooks';
import { currentDocumentLinkTarget, documentLink, readDocumentLink } from './editor/document-link';
import { useProjectKnowledgeDirectory } from './data/use-project-knowledge-directory';
import type { KnowledgeBaseSummary } from './knowledge-base-header';
import { KnowledgeEmptyState } from './knowledge-empty-state';

const knowledgeT = createTranslator(knowledgeMessages);

const LocalKnowledgeResource = dynamic(
  () => import('./local/local-knowledge-resource').then((module) => module.LocalKnowledgeResource),
  { ssr: false, loading: () => <CanvasSpinner label={knowledgeT('loadingKnowledgeResources')} /> },
);

export function KnowledgePage({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { selectedProject, scopeKey } = useProjectResources();
  const { t: knowledgeT } = useTranslation(knowledgeMessages);
  if (!selectedProject) return <CanvasState title={knowledgeT('selectProjectFirst')} />;
  return (
    <KnowledgeQueryProvider key={scopeKey}>
      <KnowledgeResources onOpenSettings={onOpenSettings} />
    </KnowledgeQueryProvider>
  );
}

function KnowledgeResources({
  onOpenSettings,
}: {
  onOpenSettings: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { selectedProject } = useProjectResources();
  const target = typeof window === 'undefined' ? null : readDocumentLink(window.location.href);
  const [chosenBaseId, onSelectBase] = useKnowledgeBaseSelection(`project:${selectedProject!.id}`, target?.knowledgeBaseId);
  const { knowledgeBases: directory, basesQuery, localStore, localError } = useProjectKnowledgeDirectory();
  const serverBases = directory.filter((base) => base.source === 'server');
  const activeBaseId =
    directory.find((base) => base.id === chosenBaseId)?.id ?? directory[0]?.id ?? null;
  const activeResource = directory.find((base) => base.id === activeBaseId)?.source ?? selectedProject!.source;
  const [creating, setCreating] = useState(false);
  const select = useCallback(
    (id: string) => {
      const source = directory.find((base) => base.id === id)?.source;
      if (!source) return;
      onSelectBase(id);
    },
    [directory, onSelectBase],
  );
  useEffect(
    () =>
      subscribeOpenPageTarget((target) => {
        if (!directory.some((base) => base.id === target.knowledgeBaseId)) return;
        if (target.knowledgeBaseId === activeBaseId) return;
        // Keep the requested page across the knowledge-base component remount.
        window.history.replaceState(
          window.history.state,
          '',
          documentLink(window.location.href, { ...target, source: activeResource }),
        );
        onSelectBase(target.knowledgeBaseId);
      }),
    [activeBaseId, onSelectBase, activeResource, directory],
  );
  const shared = {
    knowledgeBases: directory,
    onSelectKnowledgeBase: select,
    onCreateKnowledgeBase: () => setCreating(true),
    onOpenSettings,
  };
  return (
    <>
      <PageSessionNamespace key={`${activeResource}:${activeBaseId}`} name={`knowledge:${activeResource}:${activeBaseId}`}>
      {activeResource === 'local' ? (
        localStore ? (
          <LocalKnowledgeResource
            key={`local:${activeBaseId ?? 'empty'}`}
            store={localStore}
            selectedKnowledgeBaseId={activeBaseId}
            {...shared}
          />
        ) : (
          <UnavailableLocalResource detail={localError ? knowledgeT('unableToReadLocalDocumentsCheckYourBrowser') : null} {...shared} />
        )
      ) : (
        <ServerKnowledgeResource
          key={`server:${activeBaseId ?? 'empty'}`}
          activeBaseId={activeBaseId}
          baseAvailable={serverBases.some((base) => base.id === activeBaseId)}
          directoryState={{
            status: basesQuery.isFetchNextPageError
              ? 'error'
              : basesQuery.hasNextPage || basesQuery.isFetchingNextPage
                ? 'pending'
                : basesQuery.status,
            errorCode: basesQuery.error ? knowledgeErrorCodeOf(basesQuery.error) : null,
            count: serverBases.length,
          }}
          directoryError={basesQuery.error}
          retryDirectory={() => void basesQuery.refetch()}
          {...shared}
        />
      )}
      </PageSessionNamespace>
      <CreateKnowledgeBaseDialog
        key={activeResource}
        open={creating}
        initialSource={selectedProject?.source ?? 'local'}
        projectId={selectedProject?.id ?? null}
        onClose={() => setCreating(false)}
        onCreateLocal={(name) => {
          if (!localStore || !selectedProject) throw new Error(knowledgeT('localStorageUnavailable'));
          const id = crypto.randomUUID();
          localStore.update((library) => ({ ...library, bases: [...library.bases, { id, name, projectIds: [selectedProject.id] }] }));
          return id;
        }}
        onCreated={(id) => onSelectBase(id)}
      />
    </>
  );
}

function UnavailableLocalResource({
  detail,
  knowledgeBases,
  onSelectKnowledgeBase,
  onCreateKnowledgeBase,
  onOpenSettings,
}: {
  detail: string | null;
  knowledgeBases: readonly KnowledgeBaseSummary[];
  onSelectKnowledgeBase: (id: string) => void;
  onCreateKnowledgeBase: () => void;
  onOpenSettings: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [collapsed, setCollapsed] = useState(false);
  return (
    <KnowledgeWorkbench
      navigationScope="local:unavailable"
      sidebar={
        <PageTreeSidebar
          collapsed={collapsed}
          onCollapse={() => setCollapsed(true)}
          knowledgeBases={knowledgeBases}
          activeKnowledgeBaseId={null}
          onSelectKnowledgeBase={onSelectKnowledgeBase}
          onCreateKnowledgeBase={onCreateKnowledgeBase}
          onOpenSettings={onOpenSettings}
          treeArea={null}
        />
      }
      onExpandSidebar={collapsed ? () => setCollapsed(false) : undefined}
    >
      <CanvasError
        title={knowledgeT('unableToOpenLocalKnowledgeBase')}
        detail={detail ?? knowledgeT('unableToReadBrowserStorage')}
      />
    </KnowledgeWorkbench>
  );
}

function ServerKnowledgeResource({
  activeBaseId,
  baseAvailable,
  directoryState,
  directoryError,
  retryDirectory,
  knowledgeBases,
  onSelectKnowledgeBase,
  onCreateKnowledgeBase,
  onOpenSettings,
}: {
  activeBaseId: string | null;
  baseAvailable: boolean;
  directoryState: KnowledgeQuerySlice;
  directoryError: unknown;
  retryDirectory: () => void;
  knowledgeBases: readonly KnowledgeBaseSummary[];
  onSelectKnowledgeBase: (id: string) => void;
  onCreateKnowledgeBase: () => void;
  onOpenSettings: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const queryClient = useQueryClient();
  const { session, refresh, expireSession, openSignIn } = useIdentity();
  const authenticated = session.status === 'authenticated';
  const activeId = authenticated && baseAvailable ? activeBaseId : null;
  const accessQuery = useKnowledgeAccessQuery(activeId ?? '', { enabled: activeId !== null });
  const teamspacesQuery = useKnowledgeTeamspacesQuery(accessQuery.isSuccess ? activeId : null);
  const teamspaces = flattenKnowledgeBaseList(teamspacesQuery.data);
  const phase = deriveKnowledgeEntryPhase({
    session: { status: session.status },
    knowledgeBases: authenticated ? directoryState : null,
    access: activeId
      ? {
          status: accessQuery.status,
          errorCode: accessQuery.error ? knowledgeErrorCodeOf(accessQuery.error) : null,
        }
      : null,
    teamspaces:
      activeId && accessQuery.isSuccess
        ? {
            status: teamspacesQuery.status,
            errorCode: teamspacesQuery.error ? knowledgeErrorCodeOf(teamspacesQuery.error) : null,
            count: teamspaces.length,
          }
        : null,
  });
  useEffect(() => {
    if (phase === 'auth-required' && session.status === 'authenticated') expireSession();
  }, [phase, session.status, expireSession]);
  const stageActive = activeId !== null && accessQuery.isSuccess;
  useEffect(() => {
    if (!stageActive || !activeId) return;
    const controller = new AbortController();
    let connection: KnowledgeBaseEvents | undefined;
    void getFobApiOrigin()
      .then(({ origin }) => {
        if (controller.signal.aborted) return;
        connection = connectKnowledgeBaseEvents({
          knowledgeBaseId: activeId,
          origin,
          signal: controller.signal,
          invalidate: (segments) => {
            for (const key of knowledgeKeysForSegments(activeId, segments))
              void invalidateKnowledgeQueries(queryClient, key);
          },
          invalidateAll: () => {
            void invalidateKnowledgeQueries(queryClient, knowledgeBaseRootKey(activeId));
          },
        });
      })
      .catch(() => undefined);
    return () => {
      controller.abort();
      connection?.close();
    };
  }, [stageActive, activeId, queryClient]);

  const [libraryView, setLibraryView] = usePageSessionState<LibraryView>('view', 'all-documents');
  const [selectedTeamspaceId, setSelectedTeamspaceId] = usePageSessionState<string | null>('folder', null);
  const linkedPage = activeBaseId ? currentDocumentLinkTarget(activeBaseId, 'server')?.pageId ?? null : null;
  const [selectedPageId, setSelectedPageId] = usePageSessionState<string | null>('page', linkedPage, { preferInitial: Boolean(linkedPage) });
  const [editorSidebarOpen, setEditorSidebarOpen] = usePageSessionState('editorSidebar', false);
  const [sidebarCollapsed, setSidebarCollapsed] = usePageSessionState('sidebar', false);
  const [createTeamspaceOpen, setCreateTeamspaceOpen] = useState(false);
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false);
  const { notify } = useAppAlert();
  const openPage = useCallback(
    (id: string | null) => {
      setSelectedPageId(id);
      setEditorSidebarOpen(false);
    },
    [setSelectedPageId, setEditorSidebarOpen],
  );
  useKnowledgeNotificationsBridge({ active: stageActive, knowledgeBaseId: activeId, openPage });
  useEffect(
    () =>
      stageActive
        ? subscribeOpenPageTarget((target) => {
            if (target.knowledgeBaseId === activeId) openPage(target.pageId);
          })
        : undefined,
    [stageActive, activeId, openPage],
  );
  const pageOperations = usePageTreeOperations(activeId, {
    canEdit: canEditTree(accessQuery.data),
    notify,
  });
  const createTeamspace = useCreateTeamspaceMutation(activeId ?? '');
  async function createDocument(input: DocumentCreation): Promise<string | null> {
    if (!activeId) return null;
    try {
      const teamspaceId =
        input.teamspaceId ||
        (await createTeamspace.mutateAsync({ name: knowledgeT('document'), defaultAccess: 'edit' }))
          .id;
      const id = await pageOperations.createPage({ ...input, teamspaceId });
      if (id) {
        openPage(id);
        setCreateDocumentOpen(false);
      }
      return id;
    } catch {
      notify('error', knowledgeT('unableToCreateDocumentPleaseRetry'));
      return null;
    }
  }
  const selectedTeamspace =
    teamspaces.find((teamspace) => teamspace.id === selectedTeamspaceId) ?? null;
  const treeState: TreeStageTeamspaceState =
    phase === 'tree-loading'
      ? 'loading'
      : phase === 'tree-error'
        ? 'error'
        : phase === 'tree-forbidden'
          ? 'forbidden'
          : teamspaces.length
            ? 'ready'
            : 'empty';
  const treeArea =
    stageActive && activeId ? (
      <KnowledgeTreeStage
        knowledgeBaseId={activeId}
        userId={authenticated ? session.user.id : ''}
        view={libraryView}
        onNavigate={(view) => {
          setLibraryView(view);
          setSelectedPageId(null);
        }}
        teamspaces={teamspaces}
        teamspaceState={treeState}
        access={accessQuery.data}
        selectedSectionId={selectedTeamspaceId}
        selectedPageId={selectedPageId}
        onSelectSection={(id) => {
          setSelectedTeamspaceId(id);
          setSelectedPageId(null);
          setLibraryView('overview');
        }}
        onSelectPage={openPage}
        onRetryTeamspaces={() => void teamspacesQuery.refetch()}
        onCreateTeamspace={() => setCreateTeamspaceOpen(true)}
        notify={notify}
      />
    ) : null;

  function renderEditor(pageId: string, onBack: () => void) {
    if (!stageActive || !activeId || !authenticated) return null;
    return (
      <KnowledgePageEditor
        key={pageId}
        scope={{ knowledgeBaseId: activeId, pageId }}
        user={session.user}
        knowledgeBaseId={activeId}
        onBack={onBack}
        onOpenSidebar={() => setEditorSidebarOpen(true)}
        onCreateDocument={() => setCreateDocumentOpen(true)}
        canCreateDocument={canEditTree(accessQuery.data)}
      />
    );
  }
  const documentOpen = stageActive && Boolean(selectedPageId);
  function closeDocument() {
    setSelectedPageId(null);
    setLibraryView('all-documents');
  }

  let content: ReactNode = null;
  if (phase === 'session-checking') {
    content = <CanvasSpinner label={knowledgeT('checkingSignInStatus')} />;
  } else if (phase === 'session-error') {
    content = (
      <CanvasState
        tone="error"
        icon={<XCircle size={20} />}
        title={knowledgeT('unableToVerifySignInStatus')}
        hint={authErrorCopyFor(session.status === 'error' ? session.error : null).description}
        actions={
          <>
            <Button variant="outline" onClick={() => void refresh()}>
              {knowledgeT('retry')}
            </Button>
            <Button variant="ghost" onClick={openSignIn}>
              {knowledgeT('signIn')}
            </Button>
          </>
        }
      />
    );
  } else if (phase === 'auth-required') {
    content = (
      <CanvasState
        icon={<LockSimple size={20} />}
        title={knowledgeT('signInToAccessThisKnowledgeBase')}
        actions={<Button onClick={openSignIn}>{knowledgeT('signInAndContinue')}</Button>}
      />
    );
  } else if (phase === 'knowledge-bases-loading') {
    content = <CanvasSpinner label={knowledgeT('loadingKnowledgeBase')} />;
  } else if (phase === 'knowledge-bases-error') {
    content = (
      <CanvasError
        title={knowledgeT('unableToLoadKnowledgeBases')}
        detail={organizationErrorTextOf(directoryError)}
        onRetry={retryDirectory}
      />
    );
  } else if (phase === 'knowledge-bases-empty' && !activeBaseId) {
    content = <KnowledgeEmptyState onCreate={onCreateKnowledgeBase} />;
  } else if (directoryState.status === 'success' && !baseAvailable) {
    content = (
      <CanvasState
        icon={<LockSimple size={20} />}
        title={knowledgeT('unableToAccessThisKnowledgeBase')}
        hint={knowledgeT('thisKnowledgeBaseWasRemovedOrYourAccount')}
      />
    );
  } else if (phase === 'knowledge-base-loading') {
    content = <CanvasSpinner label={knowledgeT('checkingKnowledgeBasePermissions')} />;
  } else if (phase === 'knowledge-base-error') {
    content = (
      <CanvasError
        title={knowledgeT('unableToVerifyKnowledgeBasePermissions')}
        onRetry={() => void accessQuery.refetch()}
      />
    );
  } else if (phase === 'knowledge-base-forbidden') {
    content = (
      <CanvasState
        icon={<LockSimple size={20} />}
        title={knowledgeT('youDoNotHaveAccessToThisKnowledge')}
      />
    );
  } else if (activeId && authenticated) {
    content = selectedPageId ? (
      renderEditor(selectedPageId, closeDocument)
    ) : (
      <LibraryCanvas
        knowledgeBaseId={activeId}
        userId={session.user.id}
        name={knowledgeBases.find((base) => base.id === activeId)?.name ?? ''}
        view={libraryView}
        access={accessQuery.data}
        teamspaces={teamspaces}
        folder={selectedTeamspace}
        onOpenPage={openPage}
        onSelectFolder={(id) => {
          setSelectedTeamspaceId(id);
          setLibraryView('overview');
        }}
        onCreateFolder={() => setCreateTeamspaceOpen(true)}
        onExpandSidebar={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
        notify={notify}
      />
    );
  }

  return (
    <KnowledgeWorkbench
      navigationScope={`server:${authenticated ? session.user.id : 'guest'}:${activeBaseId ?? 'none'}`}
      documentOpen={documentOpen}
      sidebarOpen={documentOpen && editorSidebarOpen}
      onCloseDocument={closeDocument}
      onCloseSidebar={() => setEditorSidebarOpen(false)}
      onExpandSidebar={sidebarCollapsed ? () => setSidebarCollapsed(false) : undefined}
      renderFixedDocument={(document, onClose) =>
        stageActive &&
        document.target.source === 'server' &&
        document.target.knowledgeBaseId === activeId ? (
          renderEditor(document.target.pageId, onClose)
        ) : (
          <CanvasState
            title={knowledgeT('unableToAccessThisDocument')}
            hint={knowledgeT('checkYourKnowledgeBaseAndDocumentPermissions')}
          />
        )
      }
      sidebar={
        <PageTreeSidebar
          collapsed={documentOpen ? false : sidebarCollapsed}
          onCollapse={() =>
            documentOpen ? setEditorSidebarOpen(false) : setSidebarCollapsed(true)
          }
          knowledgeBases={knowledgeBases}
          activeKnowledgeBaseId={activeBaseId}
          onSelectKnowledgeBase={onSelectKnowledgeBase}
          onCreateKnowledgeBase={onCreateKnowledgeBase}
          onOpenSettings={onOpenSettings}
          treeArea={treeArea}
        />
      }
      overlays={
        <>
          {createDocumentOpen && activeId ? (
            <NavigationDialogPortal>
              <CreateDocumentDialog
                teamspaces={teamspaces}
                target={{ teamspaceId: selectedTeamspaceId ?? undefined, parentId: null }}
                onClose={() => setCreateDocumentOpen(false)}
                onCreate={createDocument}
              />
            </NavigationDialogPortal>
          ) : null}
          {activeId ? (
            <CreateTeamspaceDialog
              knowledgeBaseId={activeId}
              open={createTeamspaceOpen}
              onClose={() => setCreateTeamspaceOpen(false)}
              onCreated={(folder) => {
                setSelectedTeamspaceId(folder.id);
                setSelectedPageId(null);
                setLibraryView('overview');
              }}
            />
          ) : null}
        </>
      }
    >
      {content}
    </KnowledgeWorkbench>
  );
}

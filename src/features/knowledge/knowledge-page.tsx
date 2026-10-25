'use client';

import { createTranslator, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './knowledge-page.messages';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { PageSessionNamespace, usePageSessionState } from '@/lib/page-session-state';
import { useQueryClient } from '@tanstack/react-query';
import { LockSimple, XCircle } from '@/components/icons';
import dynamic from 'next/dynamic';
import { Button } from '@/components/ui/button';
import { useIdentity } from '@/features/identity/identity-provider';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { authErrorCopyFor } from '../identity/auth-errors';
import { connectKnowledgeBaseEvents, type KnowledgeBaseEvents } from './collaboration/knowledge-base-events';
import { CanvasError, CanvasSpinner, CanvasState } from './canvas-states';
import { useKnowledgeAccessQuery } from './data/hooks';
import { knowledgeKeysForSegments, knowledgeBaseRootKey } from './data/invalidation';
import { KnowledgeQueryProvider } from './data/provider';
import { invalidateKnowledgeQueries } from './data/query-client';
import { knowledgeQueryKeys } from './data/query-keys';
import { flattenKnowledgeBaseList, useKnowledgeTeamspacesQuery } from './data/catalog-queries';
import { deriveKnowledgeEntryPhase, knowledgeErrorCodeOf, type KnowledgeQuerySlice } from './entry-state';
import { useKnowledgeNotificationsBridge } from './notifications/notifications-queries';
import { subscribeOpenPageTarget } from './editor/open-target';
import { KnowledgeTreeStage, type TreeStageTeamspaceState, type LibraryView } from './navigation/tree-stage';
import { CreateTeamspaceDialog } from './navigation/create-teamspace-dialog';
import { PageTreeSidebar } from './navigation/page-tree-sidebar';
import { organizationErrorTextOf } from './organization/errors';
import { useAppAlert } from '@/components/app-alert-provider';
import { LibraryCanvas } from './navigation/library-canvas';
import { KnowledgePageEditor } from './editor';
import { KnowledgeWorkbench } from './knowledge-workbench';
import { CreateDocumentDialog, type DocumentCreation } from './navigation/create-document-dialog';
import { NavigationDialogPortal } from './navigation/navigation-dialog-portal';
import { usePageTreeOperations } from './navigation/page-operations';
import { canEditTree } from './navigation/tree-actions';
import { useCreateTeamspaceMutation } from './organization/hooks';
import { useDocumentTab, useTabDocumentSelection, useTabFolderSelection } from './editor/document-tab-context';
import { KnowledgeEmptyState } from './knowledge-empty-state';
import { useKnowledgeNavigation, useKnowledgeNavigationActive } from './navigation/system-navigation';
import { updateDocumentNavigation, updateFolderNavigation } from './navigation/document-navigation-location';
import { useKnowledgeBaseResources } from './data/knowledge-base-resources';
import { useKnowledgeDocumentTarget } from './data/use-knowledge-document-target';
import { useLocalLibrary } from './local/use-local-library';
import type { KnowledgeBaseResource } from './knowledge-base';

const knowledgeT = createTranslator(knowledgeMessages);
const LocalKnowledgeResource = dynamic(() => import('./local/local-knowledge-resource').then(module => module.LocalKnowledgeResource), { ssr: false, loading: () => <CanvasSpinner label={knowledgeT('loadingKnowledgeResources')} /> });

export function KnowledgePage() {
  const resources = useKnowledgeBaseResources();
  const { selectedKnowledgeBase: base, scopeKey, knowledgeBases, openCreateKnowledgeBase } = resources;
  const local = useLocalLibrary();
  const navigationActive = useKnowledgeNavigationActive();
  const { t } = useTranslation(knowledgeMessages);
  const { openSignIn } = useIdentity();
  const target = useKnowledgeDocumentTarget(navigationActive);
  useEffect(() => subscribeOpenPageTarget(request => {
    if (!navigationActive || request.knowledgeBaseId === base?.id) return;
    const next = knowledgeBases.find(item => item.id === request.knowledgeBaseId);
    if (next) updateDocumentNavigation({ ...request, source: next.source });
  }), [navigationActive, base?.id, knowledgeBases]);
  if (target.status === 'loading') return <CanvasSpinner label={t('resolvingDocumentKnowledgeBase')} />;
  if (target.status === 'unavailable') return <CanvasState title={t('documentTargetUnavailable')} hint={t('documentTargetUnavailableHint')} actions={<>
    {target.signIn ? <Button onClick={() => openSignIn()}>{t('signInToOpenDocument')}</Button> : target.error ? <Button variant="outline" onClick={target.retry}>{t('retry')}</Button> : null}
    <Button variant="outline" onClick={resources.clearUnavailableSelection}>{t('returnToKnowledgeLibrary')}</Button>
  </>} />;
  if (!base) {
    if (resources.status === 'loading') return <CanvasSpinner label={t('loadingKnowledgeResources')} />;
    if (resources.error) return <CanvasError title={t('unableToLoadKnowledgeBases')} detail={resources.error} onRetry={() => void resources.refreshKnowledgeBases()} />;
    if (resources.unavailableSelection) return <CanvasState title={t('unableToAccessThisKnowledgeBase')} hint={t('thisKnowledgeBaseWasRemovedOrYourAccount')} actions={<>
      {resources.requestedKnowledgeBase?.source === 'server' && resources.principal === 'guest' && <Button onClick={() => openSignIn()}>{t('signInAndContinue')}</Button>}
      <Button variant="outline" onClick={resources.clearUnavailableSelection}>{t('returnToKnowledgeLibrary')}</Button>
    </>} />;
    return <KnowledgeEmptyState onCreate={openCreateKnowledgeBase} />;
  }
  return <KnowledgeQueryProvider key={scopeKey}><PageSessionNamespace name={'knowledge:' + base.source + ':' + base.id}>
    {base.source === 'local' ? local.store ? <LocalKnowledgeResource store={local.store} selectedKnowledgeBaseId={base.id} onCreateKnowledgeBase={openCreateKnowledgeBase} /> : <CanvasError title={t('unableToOpenLocalKnowledgeBase')} detail={local.error ? t('unableToReadBrowserStorage') : t('loadingKnowledgeResources')} /> :
      <ServerKnowledgeResource activeBaseId={base.id} baseAvailable directoryState={{ status: 'success', count: knowledgeBases.filter(item => item.source === 'server').length, errorCode: null }} directoryError={null} retryDirectory={() => void resources.refreshKnowledgeBases()} knowledgeBases={knowledgeBases} onCreateKnowledgeBase={openCreateKnowledgeBase} />}
  </PageSessionNamespace></KnowledgeQueryProvider>;
}

function ServerKnowledgeResource({
  activeBaseId,
  baseAvailable,
  directoryState,
  directoryError,
  retryDirectory,
  knowledgeBases,
  onCreateKnowledgeBase,
}: {
  activeBaseId: string | null;
  baseAvailable: boolean;
  directoryState: KnowledgeQuerySlice;
  directoryError: unknown;
  retryDirectory: () => void;
  knowledgeBases: readonly KnowledgeBaseResource[];
  onCreateKnowledgeBase: () => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const queryClient = useQueryClient();
  const { expand: expandSidebar } = useKnowledgeNavigation();
  const navigationActive = useKnowledgeNavigationActive();
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

  const tabSearch = useDocumentTab()?.search;
  const routedFolder = new URLSearchParams(tabSearch).get('folder');
  const [libraryView, setLibraryView] = usePageSessionState<LibraryView>('view', routedFolder ? 'overview' : 'all-documents', { preferInitial: Boolean(routedFolder) });
  const [selectedTeamspaceId, setSelectedTeamspaceId] = useTabFolderSelection(activeBaseId ?? '', 'server');
  const [selectedPageId, setStoredSelectedPageId] = useTabDocumentSelection(activeBaseId ?? '', 'server');
  const setSelectedPageId = useCallback((id: string | null) => {
    setStoredSelectedPageId(id);
    if (navigationActive) updateDocumentNavigation(id && activeBaseId ? { knowledgeBaseId: activeBaseId, pageId: id, source: 'server' } : null, tabSearch);
  }, [setStoredSelectedPageId, navigationActive, activeBaseId, tabSearch]);
  const [createTeamspaceOpen, setCreateTeamspaceOpen] = useState(false);
  const [createDocumentOpen, setCreateDocumentOpen] = useState(false);
  const { notify } = useAppAlert();
  const openPage = useCallback(
    (id: string | null) => {
      setSelectedPageId(id);
    },
    [setSelectedPageId],
  );
  const openFolder = useCallback((id: string) => {
    setSelectedTeamspaceId(id); setSelectedPageId(null); setLibraryView('overview');
    if (navigationActive && activeId) updateFolderNavigation({ knowledgeBaseId: activeId, folderId: id, source: 'server' }, tabSearch);
  }, [setSelectedTeamspaceId, setSelectedPageId, setLibraryView, navigationActive, activeId, tabSearch]);
  useKnowledgeNotificationsBridge({ active: stageActive, knowledgeBaseId: activeId,
    openPage: id => { openPage(id); if (activeId) void queryClient.invalidateQueries({ queryKey: knowledgeQueryKeys.pages(activeId) }); void teamspacesQuery.refetch(); },
    openFolder: id => { openFolder(id); void teamspacesQuery.refetch(); },
  });
  useEffect(
    () =>
      stageActive && navigationActive
        ? subscribeOpenPageTarget((target) => {
            if (target.knowledgeBaseId === activeId) openPage(target.pageId);
          })
        : undefined,
    [stageActive, activeId, openPage, navigationActive],
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
          if (view !== 'overview') {
            setSelectedTeamspaceId(null);
            if (navigationActive && activeId) updateFolderNavigation({ knowledgeBaseId: activeId, folderId: null, source: 'server' }, tabSearch);
          }
        }}
        teamspaces={teamspaces}
        teamspaceState={treeState}
        access={accessQuery.data}
        selectedSectionId={selectedTeamspaceId}
        selectedPageId={selectedPageId}
        onSelectSection={openFolder}
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
        onOpenSidebar={expandSidebar}
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
        icon={<XCircle size={16} />}
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
        icon={<LockSimple size={16} />}
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
        icon={<LockSimple size={16} />}
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
        icon={<LockSimple size={16} />}
        title={knowledgeT('youDoNotHaveAccessToThisKnowledge')}
      />
    );
  } else if (activeId && authenticated) {
    content = selectedPageId ? (
      renderEditor(selectedPageId, closeDocument)
    ) : libraryView === 'overview' && selectedTeamspaceId && !selectedTeamspace ? (
      teamspacesQuery.isPending || (teamspacesQuery.hasNextPage && !teamspacesQuery.isFetchNextPageError) ? <CanvasSpinner label={knowledgeT('loadingKnowledgeResources')} /> : <CanvasError title={knowledgeT('folderUnavailable')} onRetry={() => void teamspacesQuery.refetch()} />
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
        onSelectFolder={openFolder}
        onCreateFolder={() => setCreateTeamspaceOpen(true)}
        notify={notify}
      />
    );
  }

  return (
    <KnowledgeWorkbench
      documentOpen={documentOpen}
      sidebar={
        <PageTreeSidebar
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
              onCreated={(folder) => openFolder(folder.id)}
            />
          ) : null}
        </>
      }
    >
      {content}
    </KnowledgeWorkbench>
  );
}

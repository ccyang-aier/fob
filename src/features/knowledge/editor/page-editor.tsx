'use client';
import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './page-editor.messages';

import { useKnowledgePagesQuery } from '../data/pages-queries';
import { documentFileFormat } from '../documents/file-format';
import { KnowledgeBaseFileDocument } from '../documents/file-document-surface';
import { flattenKnowledgeBaseList, useKnowledgeTeamspacesQuery } from '../data/catalog-queries';

/**
 * The page editor container (E03, design §4/§5.1) — the state closed loop in
 * one component, every state honest and reachable:
 *
 * 1. P03 `page.access` gate: pending spinner, retryable error, terminal
 *    forbidden — a page without view rights never mounts a session.
 * 2. B04 session: endpoint failures retry, then the document opens from the
 *    local copy regardless of the cloud connection.
 * 3. The surface: the derived view model (`derivePageEditorView`) drives the
 *    sync indicator, the readonly banner and the Tiptap editable flag, so
 *    local-only / syncing / synced / offline / error / readonly can never
 *    disagree with each other.
 */

import type { PageScope } from '@fob/shared/knowledge/contracts';
import type { FobAuthUser } from '../../identity/auth-api';
import { CanvasError, CanvasForbidden, CanvasSpinner } from '../canvas-states';
import { Button } from '@/components/ui/button';
import { knowledgeErrorCodeOf } from '../entry-state';
import { derivePageEditorView } from './editor-state';
import { PageEditorSurface } from './editor-surface';
import { usePageEditorGate } from './page-access';
import { usePageEditorSession } from './page-session';

function pageAccessErrorText(error: unknown, locale: Locale): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  const copy: Record<string, string> = {
    UNAVAILABLE: knowledgeT('knowledgeServiceUnavailableRetryLater'),
    NETWORK: knowledgeT('unableToConnectToKnowledgeServiceCheckYour'),
    TIMEOUT: knowledgeT('knowledgeServiceConnectionTimedOutPleaseRetry'),
    RATE_LIMITED: knowledgeT('tooManyRequestsRetryLater'),
    ENDPOINT: knowledgeT('knowledgeServiceAddressIsNotConfigured'),
    PAYMENT_REQUIRED: knowledgeT('thisActionRequiresAHigherAccessLevel'),
  };
  const code = knowledgeErrorCodeOf(error);
  return (code && copy[code]) ?? knowledgeT('unableToVerifyPageAccessPleaseRetry');
}

/** The page editor of one open page; mounts inside the U02 canvas main column. */
export function PageEditor({
  scope,
  user,
  knowledgeBaseId,
  onBack,
  onOpenSidebar,
  onCreateDocument,
  canCreateDocument,
}: {
  scope: PageScope;
  user: FobAuthUser | null;
  knowledgeBaseId: string;
  onBack: () => void;
  onOpenSidebar: () => void;
  onCreateDocument: () => void;
  canCreateDocument: boolean;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const pages = useKnowledgePagesQuery(scope.knowledgeBaseId);
  const folders = useKnowledgeTeamspacesQuery(scope.knowledgeBaseId);
  const page = pages.data?.find((item) => item.id === scope.pageId);
  const folderName =
    flattenKnowledgeBaseList(folders.data).find((folder) => folder.id === page?.teamspaceId)
      ?.name ?? knowledgeT('containingFolder');
  const format = page ? documentFileFormat(page.title) : null;
  const isFile = Boolean(page?.properties.fileAsset || (format && format !== 'markdown'));
  const { gate, error: gateError, retry } = usePageEditorGate(scope.knowledgeBaseId, scope.pageId);
  // The collaboration session only exists once view access has been granted —
  // a denied page never opens a WebSocket or an IndexedDB copy.
  const session = usePageEditorSession(
    gate.status === 'granted' && pages.isSuccess && !isFile ? scope : null,
    user?.id ?? 'anonymous',
  );
  const view = derivePageEditorView(gate, session.status);

  if (gate.status === 'pending') {
    return <CanvasSpinner label={knowledgeT('checkingPageAccess')} />;
  }
  if (gate.status === 'error') {
    return (
      <CanvasError
        title={knowledgeT('unableToVerifyPageAccess')}
        detail={pageAccessErrorText(gateError, locale)}
        onRetry={retry}
      />
    );
  }
  if (gate.status === 'denied') {
    return (
      <CanvasForbidden
        title={knowledgeT('youDoNotHaveAccessToThisPage')}
        detail={knowledgeT('yourCredentialsCannotViewThisPageContactIts')}
        actions={
          <Button variant="outline" onClick={onBack}>
            {knowledgeT('backToKnowledgeBase')}
          </Button>
        }
      />
    );
  }
  if (pages.isPending) return <CanvasSpinner label={knowledgeT('readingDocumentInformation')} />;
  if (pages.isError)
    return (
      <CanvasError
        title={knowledgeT('unableToReadDocumentInformation')}
        detail={knowledgeT('checkYourConnectionAndRetry')}
        onRetry={() => {
          void pages.refetch();
        }}
      />
    );
  if (gate.status === 'granted' && isFile && page)
    return (
      <KnowledgeBaseFileDocument
        knowledgeBaseId={scope.knowledgeBaseId}
        page={page}
        canComment={gate.level !== 'view'}
        canEdit={gate.level === 'edit' || gate.level === 'full'}
        avatarName={user?.name ?? knowledgeT('me')}
        folderName={folderName}
        onBack={onBack}
        onOpenSidebar={onOpenSidebar}
        onCreateDocument={onCreateDocument}
      />
    );
  if (session.failure) {
    return (
      <CanvasError
        title={knowledgeT('unableToOpenPageDocument')}
        detail={session.failure}
        onRetry={session.retry}
      />
    );
  }
  if (!session.session || !session.undo) {
    return <CanvasSpinner label={knowledgeT('openingDocument')} />;
  }
  return (
    <PageEditorSurface
      scope={scope}
      session={session.session}
      origin={session.origin}
      user={user}
      pageUndo={session.undo}
      level={gate.level}
      view={view}
      folderName={folderName}
      knowledgeBaseId={knowledgeBaseId}
      onBack={onBack}
      onOpenSidebar={onOpenSidebar}
      onCreateDocument={onCreateDocument}
      canCreateDocument={canCreateDocument}
    />
  );
}

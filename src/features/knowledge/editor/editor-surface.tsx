'use client';

import { useKnowledgeNavigationActive } from '../navigation/system-navigation';
import { useProfileLearning } from '../profile/use-profile-learning';

import { useTranslation } from '@/lib/i18n';
import { formatRelativeTime } from '@/lib/relative-time';
import { knowledgeMessages } from './editor-surface.messages';
/**
 * The editor surface of one page (E03): the Tiptap instance bound to the
 * shared E01 registry schema (never a second schema), the E02 blockId
 * extension and the B04/B08 collaboration extension, wrapped in the toolbar /
 * sync indicator / access metadata frame.
 *
 * `immediatelyRender: false` keeps the editor instance strictly
 * client-after-mount (no SSR rendering, no hydration mismatch); the body
 * itself lives in the Y.Doc — the component holds no second content state.
 */

import { useEffect, useMemo, useState } from 'react';
import { useEditor } from '@tiptap/react';
import type { PageScope, PermissionLevel } from '@fob/shared/knowledge/contracts';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { useQueryClient } from '@tanstack/react-query';
import type { FobAuthUser } from '../../identity/auth-api';
import type { PageUndo } from '../collaboration/page-undo';
import type { PageDocumentSession } from '../collaboration/page-provider';
import { AwarenessMembers, createAwarenessExtension } from './awareness';
import { applyEditorBlockModules } from './block-modules';
import { createSlashPasteExtensions } from './commands';
import { DocumentEditorBody, DocumentEditorFrame, DocumentHeading } from './editor-layout';
import { PageIconPicker } from '../navigation/page-icon-picker';
import { DocumentEditorHeader } from './components/document-editor-header';
import { DocumentInteractions } from './components/document-interactions';
import { DocumentAccessIndicator } from './components/document-access-indicator';
import { DocumentSidebar } from './components/document-sidebar';
import { AppAlert } from '@/components/app-alert';
import { SyncIndicator } from './components/document-editor-header/sync-indicator';
import type { PageEditorViewModel } from './editor-state';
import {
  revealBlockInEditor,
  subscribeOpenPageTarget,
  takeStagedBlockHighlight,
} from './open-target';
import { pageCollaborationExtension } from './page-collaboration';
import { createPageReviewExtension, PageReviewRail } from './review-integration';
import { createBlockEditingExtensions } from './extensions';
import { HistoryPanel } from '../history/history-panel';
import { useDocumentVersion } from '../history/use-document-version';
import { VersionDocument } from '../history/version-document';
import { activityMessages } from '../history/activity.messages';
import { Button } from '@/components/ui/button';
import {
  createCommentsEditorExtension,
  PageCommentsLayer,
} from './comments-integration';
import { usePageMetadata } from './use-page-metadata';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { recycleKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import { useDocumentReference } from './document-reference';
import { useEditorLocale } from './use-editor-locale';
import { useDocumentSharing, collaborationRequest, mutationReply } from '../sharing/collaboration-api';
import { messages as collaborationMessages } from '../sharing/collaboration.messages';
import historyStyles from '../history/history-panel.module.css';

export function PageEditorSurface({
  scope,
  session,
  origin,
  user,
  pageUndo,
  level,
  view,
  folderName,
  knowledgeBaseId,
  onBack,
  onOpenSidebar,
  onCreateDocument,
  canCreateDocument,
}: {
  scope: PageScope;
  /** The live B04 page session — its document is the only body authority. */
  session: PageDocumentSession;
  /** Resolved knowledge API origin (block-reference source connections). */
  origin: string | null;
  /** The signed-in human the awareness publishes as (B07). */
  user: FobAuthUser | null;
  pageUndo: PageUndo;
  level: PermissionLevel;
  view: PageEditorViewModel;
  folderName: string;
  knowledgeBaseId: string;
  onBack: () => void;
  onOpenSidebar: () => void;
  onCreateDocument: () => void;
  canCreateDocument: boolean;
}) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const { t: collaborationT } = useTranslation(collaborationMessages);
  const { t: activityT } = useTranslation(activityMessages);
  const version = useDocumentVersion(scope);

  const fixedPane = Boolean(useDocumentReference()?.fixed);
  const document = session.document;
  // Focus refreshes replace the session user object even when its identity is
  // unchanged. Keep that refresh from destroying file pickers and live uploads.
  const userId = user?.id;
  const userName = user?.name;
  const userImage = user?.image ?? null;
  // One extension set per page session: shared registry (E01) with the
  // block/callout/table and block-reference NodeViews layered on (E05/L02),
  // blockId integrity (E02), the y-prosemirror binding (B04/B08), suggestion
  // marks (S01), comments (N02), markdown/keyboard block editing (E04), the
  // slash menu + paste pipeline (E06) and presence cursors (B07).
  const extensions = useMemo(() => {
    const registry = applyEditorBlockModules(createKnowledgeExtensions(), {
      scope,
      origin: origin ?? '',
      cacheIdentity: userId ?? 'anonymous',
    });
    return [
      ...registry,
      createBlockIdExtension({ pageId: scope.pageId }),
      pageCollaborationExtension(document, pageUndo),
      createPageReviewExtension(),
      createCommentsEditorExtension(),
      ...createBlockEditingExtensions(),
      ...createSlashPasteExtensions(),
      ...(userId
        ? [
            createAwarenessExtension({
              getAwareness: () => session.awareness,
              subscribeAwareness: session.subscribe,
              identity: { userId, name: userName ?? '', image: userImage },
            }),
          ]
        : []),
    ];
    // The scope object itself is re-created by the shell on every render, so
    // only its identity-bearing fields belong here — otherwise the inline
    // object would rebuild (and remount) the editor on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.pageId, scope.knowledgeBaseId, document, pageUndo, origin, userId, userName, userImage, session]);

  const editor = useEditor(
    {
      immediatelyRender: false,
      autofocus: false,
      editable: view.editable,
      extensions,
      editorProps: { attributes: { 'aria-label': knowledgeT('pageContent') } },
    },
    [extensions],
  );
  useEditorLocale(editor, locale, knowledgeT('pageContent'));

  // The P03 level and the B04 error phase can both change while mounted;
  // keep the instance's editable flag glued to the derived decision.
  useEffect(() => {
    editor?.setEditable(view.editable && !version.selectedId);
  }, [editor, view.editable, version.selectedId]);

  const navigationActive = useKnowledgeNavigationActive();
  useProfileLearning(scope,navigationActive && Boolean(user));
  // L02: a block-reference click that lands on this page reveals the block —
  // a pre-mount navigation consumes its staged highlight, later targets ride
  // the open-target channel (both selection-free).
  useEffect(() => {
    if (!editor || fixedPane || !navigationActive) return undefined;
    const staged = takeStagedBlockHighlight({
      knowledgeBaseId: scope.knowledgeBaseId,
      pageId: scope.pageId,
    });
    if (staged) revealBlockInEditor(editor.view, staged.blockId);
    return subscribeOpenPageTarget((target) => {
      if (
        target.knowledgeBaseId === scope.knowledgeBaseId &&
        target.pageId === scope.pageId &&
        target.blockId
      )
        revealBlockInEditor(editor.view, target.blockId);
    });
  }, [editor, scope.knowledgeBaseId, scope.pageId, fixedPane, navigationActive]);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const collaboration = useDocumentSharing(scope);
  useEffect(() => {
    if (!navigationActive) return;
    const controller = new AbortController();
    void collaborationRequest({ knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId }, '/visits', mutationReply, {}, controller.signal).catch(() => {});
    return () => controller.abort();
  }, [scope.knowledgeBaseId, scope.pageId, navigationActive]);
  const queryClient = useQueryClient();
  const { collections, toggleStar } = useSidebarCollections(user?.id ?? '', scope.knowledgeBaseId);
  const pageTitle = usePageMetadata(scope);
  const updatedLabel = pageTitle.createdAt
    ? collaborationT(pageTitle.createdBy === user?.id ? 'createdByYou' : 'createdByPerson', {
        time: formatRelativeTime(Date.parse(pageTitle.createdAt), locale),
        name: collaboration.data?.people.find(person => person.id === pageTitle.createdBy)?.name ?? collaborationT('member'),
      })
    : knowledgeT('document');
  const displayEditor = version.selectedId ? version.editor : editor;
  const displayTitle = version.selectedId ? version.preview.data?.title ?? pageTitle.title : pageTitle.title;
  const closeHistory = () => { version.select(null); setHistoryOpen(false); };

  return (
    <DocumentEditorFrame
      blockEdits={{ document }}
      appearanceScope={`knowledgeBase:${user?.id ?? 'guest'}:${scope.knowledgeBaseId}:${scope.pageId}`}
      navigation={{
        editor: displayEditor,
        title: displayTitle,
        target: { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, source: 'server' },
      }}
      sidebar={
        <PageCommentsLayer
          scope={scope}
          knowledgeBaseId={knowledgeBaseId}
          editor={version.selectedId ? null : editor}
          level={level}
          currentUser={user}
          railOpen={commentsOpen}
          onRailOpenChange={setCommentsOpen}
        >
          <PageReviewRail editor={version.selectedId ? null : editor} editable={view.editable && !version.selectedId} />
          {historyOpen && (
            <DocumentSidebar panel="history" defaultWidth={400} className={historyStyles.rail}>
              <HistoryPanel
                knowledgeBaseId={scope.knowledgeBaseId}
                pageId={scope.pageId}
                selectedVersionId={version.selectedId}
                onSelectVersion={version.select}
                onClose={closeHistory}
              />
            </DocumentSidebar>
          )}
        </PageCommentsLayer>
      }
      header={
        <DocumentEditorHeader
          editor={displayEditor}
          folderName={folderName}
          title={displayTitle}
          avatarName={user?.name ?? knowledgeT('me')}
          starred={collections.starred.includes(scope.pageId)}
          onOpenSidebar={onOpenSidebar}
          onToggleStar={() => toggleStar(scope.pageId)}
          interactions={<DocumentInteractions key={`${scope.knowledgeBaseId}:${scope.pageId}:${user?.id}`} scope={scope} commentsOpen={commentsOpen} onComments={() => {
            version.select(null); setHistoryOpen(false); setCommentsOpen(value => !value);
          }} />}
          onCreateDocument={onCreateDocument}
          canCreateDocument={canCreateDocument}
          shareDescription={knowledgeT('copyTheTitleAndContentToPasteInto')}
          presence={
            user ? (
              <AwarenessMembers
                awareness={session.awareness}
                identity={{ userId: user.id, name: user.name, image: user.image }}
                people={collaboration.data?.people}
                connected={['synced', 'syncing'].includes(view.sync.badge)}
              />
            ) : undefined
          }
          menuActions={{
            canImport: canCreateDocument && !version.selectedId,
            canMove: level === 'full',
            target: {
              knowledgeBaseId: scope.knowledgeBaseId,
              pageId: scope.pageId,
              source: 'server',
            },
            onComments: () => {
              version.select(null);
              setHistoryOpen(false);
              setCommentsOpen(true);
            },
            onHistory: () => {
              setCommentsOpen(false);
              setHistoryOpen(true);
            },
            onDelete: view.editable
              ? async () => {
                  await recycleKnowledgePage(scope.knowledgeBaseId, { pageId: scope.pageId });
                  void queryClient.invalidateQueries({
                    queryKey: knowledgeQueryKeys.pages(scope.knowledgeBaseId),
                  });
                  onBack();
                }
              : undefined,
          }}
        />
      }
    >
      {version.selectedId ? version.preview.isPending ? <p role="status" className={historyStyles.versionState}>{activityT('loadingVersion')}</p>
        : version.preview.isError ? <div className={historyStyles.versionState}><AppAlert tone="error" title={activityT('failedVersion')} /><Button variant="outline" size="sm" onClick={() => void version.preview.refetch()}>{activityT('retry')}</Button></div>
          : <VersionDocument key={version.selectedId} scope={scope} version={version.preview.data} origin={origin ?? ''} identity={user?.id ?? 'anonymous'} onEditor={version.bindEditor} onCurrent={() => version.select(null)} />
        : <DocumentEditorBody
        editor={editor}
        before={<DocumentHeading
            title={pageTitle.title}
            icon={
              <PageIconPicker
                value={pageTitle.icon}
                editable={view.editable && pageTitle.loaded}
                onChange={pageTitle.saveIcon}
              />
            }
            editable={view.editable && pageTitle.loaded}
            onTitleChange={pageTitle.setTitle}
            onTitleCommit={() => {
              void pageTitle.save();
            }}
            metadataStatus={view.readonlyReason ? <DocumentAccessIndicator reason={view.readonlyReason} level={level} /> : undefined}
            metadata={
              <>
                <span>{updatedLabel}</span>
                {view.sync.badge !== 'synced' && <SyncIndicator view={view.sync} />}
                {pageTitle.fetchError ? (
                  <span role="alert" className="text-[var(--err-ink)]">
                    {knowledgeT('titleUnavailable')}
                  </span>
                ) : null}
                {pageTitle.saving ? <span>{knowledgeT('savingTitle')}</span> : null}
                {pageTitle.error ? (
                  <span role="alert" className="text-[var(--err-ink)]">
                    {pageTitle.error}
                  </span>
                ) : null}
              </>
            }
          />}
      />}
    </DocumentEditorFrame>
  );
}

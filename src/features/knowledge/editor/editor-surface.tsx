'use client';

import { useKnowledgeNavigationActive } from '../navigation/system-navigation';

import { formatDate, useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './editor-surface.messages';
/**
 * The editor surface of one page (E03): the Tiptap instance bound to the
 * shared E01 registry schema (never a second schema), the E02 blockId
 * extension and the B04/B08 collaboration extension, wrapped in the toolbar /
 * sync indicator / readonly banner frame.
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
import { createSlashPasteExtensions, SlashMenuLayer } from './commands';
import { DocumentEditorBody, DocumentEditorFrame, DocumentHeading } from './editor-layout';
import { PageIconPicker } from '../navigation/page-icon-picker';
import { DocumentEditorHeader } from './components/document-editor-header';
import { AppAlert } from '@/components/app-alert';
import { readonlyMessageCopy } from './editor-state';
import { SyncIndicator } from './components/sync-indicator';
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
import {
  createCommentsEditorExtension,
  PageCommentsLayer,
  PageCommentsTrigger,
} from './comments-integration';
import { usePageMetadata } from './use-page-metadata';
import { useSidebarCollections } from '../navigation/sidebar-collections';
import { TaskProgress } from './block-modules/task-list/task-progress';
import { recycleKnowledgePage } from '../data/pages-api';
import { knowledgeQueryKeys } from '../data/query-keys';
import { useDocumentReference } from './document-reference';
import { useEditorLocale } from './use-editor-locale';

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

  const fixedPane = Boolean(useDocumentReference()?.fixed);
  const document = session.document;
  // One extension set per page session: shared registry (E01) with the
  // block/callout/table and block-reference NodeViews layered on (E05/L02),
  // blockId integrity (E02), the y-prosemirror binding (B04/B08), suggestion
  // marks (S01), comments (N02), markdown/keyboard block editing (E04), the
  // slash menu + paste pipeline (E06) and presence cursors (B07).
  const extensions = useMemo(() => {
    const registry = applyEditorBlockModules(createKnowledgeExtensions(), {
      scope,
      origin: origin ?? '',
      cacheIdentity: user?.id ?? 'anonymous',
    });
    return [
      ...registry,
      createBlockIdExtension({ pageId: scope.pageId }),
      pageCollaborationExtension(document, pageUndo),
      createPageReviewExtension(),
      createCommentsEditorExtension(),
      ...createBlockEditingExtensions(),
      ...createSlashPasteExtensions(),
      ...(user
        ? [
            createAwarenessExtension({
              getAwareness: () => session.awareness,
              subscribeAwareness: session.subscribe,
              identity: { userId: user.id, name: user.name, image: user.image },
            }),
          ]
        : []),
    ];
    // The scope object itself is re-created by the shell on every render, so
    // only its identity-bearing fields belong here — otherwise the inline
    // object would rebuild (and remount) the editor on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope.pageId, scope.knowledgeBaseId, document, pageUndo, origin, user, session]);

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
    editor?.setEditable(view.editable);
  }, [editor, view.editable]);

  const navigationActive = useKnowledgeNavigationActive();
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
  const queryClient = useQueryClient();
  const { collections, toggleStar } = useSidebarCollections(user?.id ?? '', scope.knowledgeBaseId);
  const pageTitle = usePageMetadata(scope);
  const updatedLabel = pageTitle.updatedAt
    ? knowledgeT('youUpdatedValue', {
        v0: formatDate(
          pageTitle.updatedAt,
          { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' },
          locale,
        ),
      })
    : knowledgeT('document');

  return (
    <DocumentEditorFrame
      appearanceScope={`knowledgeBase:${user?.id ?? 'guest'}:${scope.knowledgeBaseId}:${scope.pageId}`}
      navigation={{
        editor,
        title: pageTitle.title,
        target: { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, source: 'server' },
      }}
      sidebar={
        <PageCommentsLayer
          scope={scope}
          knowledgeBaseId={knowledgeBaseId}
          editor={editor}
          level={level}
          currentUser={user}
          railOpen={commentsOpen}
          onRailOpenChange={setCommentsOpen}
        >
          <PageReviewRail editor={editor} editable={view.editable} />
          {historyOpen && (
            <aside className="flex h-full w-[320px] shrink-0 flex-col border-l border-[var(--line)] bg-[var(--panel)]">
              <HistoryPanel
                knowledgeBaseId={scope.knowledgeBaseId}
                pageId={scope.pageId}
                editor={editor}
                canEdit={view.editable}
                onClose={() => setHistoryOpen(false)}
              />
            </aside>
          )}
        </PageCommentsLayer>
      }
      header={
        <DocumentEditorHeader
          editor={editor}
          folderName={folderName}
          title={pageTitle.title}
          avatarName={user?.name ?? knowledgeT('me')}
          starred={collections.starred.includes(scope.pageId)}
          onOpenSidebar={onOpenSidebar}
          onToggleStar={() => toggleStar(scope.pageId)}
          onCreateDocument={onCreateDocument}
          canCreateDocument={canCreateDocument}
          shareDescription={knowledgeT('copyTheTitleAndContentToPasteInto')}
          presence={
            user ? (
              <AwarenessMembers
                awareness={session.awareness}
                identity={{ userId: user.id, name: user.name, image: user.image }}
              />
            ) : undefined
          }
          menuActions={{
            target: {
              knowledgeBaseId: scope.knowledgeBaseId,
              pageId: scope.pageId,
              source: 'server',
            },
            onComments: () => {
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
      {view.readonlyReason ? (
        <AppAlert
          tone={view.readonlyReason === 'auth-failed' ? 'error' : 'info'}
          title={readonlyMessageCopy(view.readonlyReason, level)}
          className="mx-4 mt-3"
        />
      ) : null}
      <DocumentEditorBody
        editor={editor}
        before={
          <DocumentHeading
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
            metadata={
              <>
                <span>{updatedLabel}</span>
                <TaskProgress editor={editor} />
                <SyncIndicator view={view.sync} />
                <span>
                  {level === 'view'
                    ? knowledgeT('viewOnly')
                    : level === 'comment'
                      ? knowledgeT('canComment')
                      : knowledgeT('canEdit')}
                </span>
                <span>{knowledgeT('viewed')}</span>
                <PageCommentsTrigger
                  scope={scope}
                  open={commentsOpen}
                  onToggle={() => {
                    setHistoryOpen(false);
                    setCommentsOpen((value) => !value);
                  }}
                />
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
          />
        }
      />
      <SlashMenuLayer editor={editor} />
    </DocumentEditorFrame>
  );
}

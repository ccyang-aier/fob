'use client';

import { createTranslator, useTranslation, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './comments-controller.messages';
/** Joins PostgreSQL threads/likes with CRDT selection anchors and owns authorized mutations.
 * Page comments can be written independently of the editor selection; quoted
 * comments share client IDs with their optimistic anchors. Live events and
 * local mutations invalidate the same knowledgeBase/page comment query.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import type { CommentThreadKind } from '@fob/shared/knowledge/comments';
import type { PageScope, PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
import { isKnowledgeDataError } from '../data/errors';
import { useKnowledgeAccessQuery } from '../data/hooks';
import {
  anchorExcerpt,
  buildAddCommentSelectionTransaction,
  buildRemoveCommentAnchorTransaction,
  collectCommentAnchors,
} from './comment-anchors';
import type { CommentAnchor } from './comment-anchors';
import { bindSelectionCommentComposer, type CommentComposePoint } from './comment-compose-bridge';
import {
  activeCommentThreadId,
  commentsPluginKey,
  selectCommentThread,
  setCommentAnchorContextOnEditor,
} from './comments-plugin';
import type { CommentAnchorContext } from './comments-plugin';
import {
  useCreateCommentThread,
  useDeleteComment,
  usePageCommentThreads,
  useReplyCommentThread,
  useReopenCommentThread,
  useResolveCommentThread,
  useSetCommentLike,
  useUpdateComment,
} from './comments-queries';
import { deriveCommentSidebarModel } from './comments-view-model';
import { CommentsSidebar } from './components/comments-sidebar';
import { CommentComposer } from './components/comment-composer';
import { SelectionCommentPopover } from './components/selection-comment-popover';
import type { CommentAuthor } from './components/comment-entry';
import type { CommentReplyTarget } from './components/comment-thread-card';
import { useMembersQuery } from '../organization/hooks';
import { commentLink, readCommentLink } from './comment-link';

const EMPTY_THREAD_IDS: ReadonlySet<string> = new Set();
const EMPTY_ANCHORS: CommentAnchor[] = [];

interface ComposingDraft {
  threadId: string;
  commentId: string;
  excerpt: string;
  pdfAnchor?: PdfCommentAnchor;
}

export interface PdfCommentBridge {
  assetHash: string;
  bindCompose: (
    compose: (selection: { anchor: PdfCommentAnchor; x: number; y: number }) => void,
  ) => () => void;
  onLocate: (anchor: PdfCommentAnchor) => void;
  activeThreadId: string | null;
  onSelectThread: (id: string) => void;
}

function commentErrorText(error: unknown, fallback: string, locale?: Locale): string {
  if (!isKnowledgeDataError(error)) return fallback;
  function copy(locale?: Locale): Record<string, string> {
    const knowledgeT = createTranslator(knowledgeMessages, locale);
    return {
      NETWORK: knowledgeT('unableToConnectToKnowledgeServiceCheckYour'),
      TIMEOUT: knowledgeT('requestTimedOutPleaseRetry'),
      RATE_LIMITED: knowledgeT('tooManyRequestsRetryLater'),
      UNAVAILABLE: knowledgeT('commentServiceUnavailableRetryLater'),
      UNAUTHENTICATED: knowledgeT('yourSessionHasExpiredSignInAgainTo'),
      FORBIDDEN: knowledgeT('yourPermissionsDoNotAllowThisCommentAction'),
      INVALID_REQUEST: knowledgeT('invalidCommentContentOrParameters'),
    };
  }
  return copy(locale)[error.code] ?? fallback;
}

export interface PageCommentsProps {
  pdf?: PdfCommentBridge;
  followDocumentLink?: boolean;
  scope: PageScope;
  knowledgeBaseId: string;
  /** The live Tiptap instance of the page editor (null while it mounts). */
  editor: Editor | null;
  canComment: boolean;
  railOpen?: boolean;
  onRailOpenChange?: (open: boolean) => void;
  currentUser?: { id: string; name: string; image?: string | null } | null;
}

export function PageComments({
  scope,
  knowledgeBaseId,
  editor,
  pdf,
  canComment,
  currentUser,
  railOpen: controlledRailOpen,
  onRailOpenChange,
  followDocumentLink = true,
}: PageCommentsProps) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);

  const threadsQuery = usePageCommentThreads(scope.knowledgeBaseId, scope.pageId);
  const accessQuery = useKnowledgeAccessQuery(scope.knowledgeBaseId);
  const currentUserId = accessQuery.data?.userId ?? null;
  const threads = useMemo(() => threadsQuery.data ?? [], [threadsQuery.data]);

  const createMutation = useCreateCommentThread(scope.knowledgeBaseId);
  const replyMutation = useReplyCommentThread(scope.knowledgeBaseId);
  const resolveMutation = useResolveCommentThread(scope.knowledgeBaseId);
  const reopenMutation = useReopenCommentThread(scope.knowledgeBaseId);
  const deleteMutation = useDeleteComment(scope.knowledgeBaseId);
  const likeMutation = useSetCommentLike(scope.knowledgeBaseId);
  const editMutation = useUpdateComment(scope.knowledgeBaseId);
  const pageCommentMutation = useCreateCommentThread(scope.knowledgeBaseId);
  const pageDraft = useRef<{
    threadId: string;
    commentId: string;
    bodyMd: string;
    kind: CommentThreadKind;
  } | null>(null);

  // Anchors belong to one editor instance; a stale editor's anchors never
  // render after a scope switch (derived, not reset in an effect).
  const [anchorState, setAnchorState] = useState<{ editor: Editor | null; value: CommentAnchor[] }>(
    { editor: null, value: [] },
  );
  const anchors = anchorState.editor === editor ? anchorState.value : EMPTY_ANCHORS;
  const [editorActiveThreadId, setActiveThreadId] = useState<string | null>(null);
  const activeThreadId = pdf?.activeThreadId ?? editorActiveThreadId;
  const [composing, setComposing] = useState<ComposingDraft | null>(null);
  const [composerError, setComposerError] = useState<{ cause: unknown } | null>(null);
  const [composerAt, setComposerAt] = useState<{ x: number; y: number } | null>(null);
  const [localRailOpen, setLocalRailOpen] = useState(false);
  const railOpen = controlledRailOpen ?? localRailOpen;
  const membersQuery = useMembersQuery(railOpen ? scope.knowledgeBaseId : null);
  const authors = useMemo(() => {
    const names = new Map<string, CommentAuthor>();
    for (const page of membersQuery.data?.pages ?? [])
      for (const member of page.items) names.set(member.userId, { name: member.name });
    if (currentUser)
      names.set(currentUser.id, { name: currentUser.name, image: currentUser.image });
    return names;
  }, [membersQuery.data, currentUser]);
  const setRailOpen = onRailOpenChange ?? setLocalRailOpen;
  const [replyTarget, setReplyTarget] = useState<CommentReplyTarget | null>(null);
  const lastDocRef = useRef<unknown>(null);
  const followedLink = useRef<string | null>(null);
  const sidebarHost = useRef<HTMLDivElement>(null);

  // ── Editor wiring: anchors and active thread ──
  useEffect(() => {
    if (!editor) return undefined;
    const readAnchors = () => {
      const doc = editor.state.doc;
      if (doc === lastDocRef.current) return;
      lastDocRef.current = doc;
      setAnchorState({ editor, value: collectCommentAnchors(doc) });
    };
    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      const id = activeCommentThreadId(editor.state);
      // Explicit picks reopen even the same discussion; typing and context
      // refreshes must leave a deliberately closed rail alone.
      const selection = transaction.getMeta(commentsPluginKey) as { type?: string } | undefined;
      if (id !== null && selection?.type === 'select') setRailOpen(true);
      setActiveThreadId(id);
    };
    readAnchors();
    editor.on('transaction', onTransaction);
    editor.on('update', readAnchors);
    return () => {
      editor.off('transaction', onTransaction);
      editor.off('update', readAnchors);
    };
  }, [editor, setRailOpen]);

  // The active thread's card scrolls into view inside the rail.
  useEffect(() => {
    if (!activeThreadId || !railOpen) return;
    const root =
      editor?.view.dom.closest('[data-knowledge-editor]') ??
      sidebarHost.current?.closest('[data-knowledge-editor]');
    root
      ?.querySelector(`[data-comment-card="${activeThreadId}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeThreadId, railOpen, editor, threads]);

  const excerptOf = useCallback(
    (anchor: CommentAnchor) => (editor ? anchorExcerpt(editor.state.doc, anchor.ranges) : ''),
    [editor],
  );

  const pendingThreadIds = useMemo(
    () => (composing ? new Set([composing.threadId]) : EMPTY_THREAD_IDS),
    [composing],
  );

  // A failed list query cannot judge orphanhood — anchors render neutral then.
  const model = useMemo(
    () =>
      deriveCommentSidebarModel(
        {
          threads,
          anchors: threadsQuery.error ? [] : anchors,
          excerptOf,
          pending: pendingThreadIds,
          pdfAssetHash: pdf?.assetHash,
        },
        locale,
      ),
    [threads, anchors, threadsQuery.error, excerptOf, pendingThreadIds, pdf?.assetHash, locale],
  );

  // ── Plugin styling context: editor and sidebar share one truth ──
  // (The active/flash styles follow the plugin's own select meta instead.)
  useEffect(() => {
    if (!editor) return;
    const context: CommentAnchorContext = {
      resolved: model.resolvedThreadIds,
      orphan: model.orphanThreadIds,
      pending: pendingThreadIds,
      counts: new Map(threads.map((thread) => [thread.id, thread.comments.length])),
    };
    if (setCommentAnchorContextOnEditor(editor, context)) {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(commentsPluginKey, { type: 'context' })
          .setMeta('addToHistory', false),
      );
    }
  }, [editor, model, pendingThreadIds, threads]);

  // A document link selects the discussion through the same editor event as
  // an anchor click, including page comments that have no text selection.
  useEffect(() => {
    if (!followDocumentLink) return;
    const target = readCommentLink(window.location.href);
    if (
      (!editor && !pdf) ||
      !target ||
      target.source !== 'server' ||
      target.knowledgeBaseId !== scope.knowledgeBaseId ||
      target.pageId !== scope.pageId ||
      target.knowledgeBaseId !== knowledgeBaseId ||
      followedLink.current === target.commentId
    )
      return;
    const thread = threads.find((thread) =>
      thread.comments.some((entry) => entry.id === target.commentId),
    );
    if (!thread) return;
    if (pdf && pdf.activeThreadId !== thread.id) {
      pdf.onSelectThread(thread.id);
      setRailOpen(true);
    }
    if (editor && activeCommentThreadId(editor.state) !== thread.id) {
      editor.view.dispatch(
        editor.state.tr
          .setMeta(commentsPluginKey, { type: 'select', id: thread.id })
          .setMeta('addToHistory', false),
      );
    }
    if (!railOpen) return;
    followedLink.current = target.commentId;
    if (thread.pdfAnchor?.assetHash === pdf?.assetHash && thread.pdfAnchor)
      pdf?.onLocate(thread.pdfAnchor);
    editor?.view.dom
      .closest('[data-knowledge-editor]')
      ?.querySelector(`[data-comment-id="${target.commentId}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [
    scope.knowledgeBaseId,
    scope.pageId,
    knowledgeBaseId,
    threads,
    railOpen,
    editor,
    pdf,
    followDocumentLink,
    setRailOpen,
  ]);

  const bindPdfCompose = pdf?.bindCompose;
  useEffect(() => {
    if (!bindPdfCompose || !canComment || composing) return;
    return bindPdfCompose(({ anchor, x, y }) => {
      setComposing({
        threadId: crypto.randomUUID(),
        commentId: crypto.randomUUID(),
        excerpt: anchor.quote,
        pdfAnchor: anchor,
      });
      setComposerAt({ x, y });
      setComposerError(null);
    });
  }, [bindPdfCompose, canComment, composing]);

  const dispatchRemoveAnchor = useCallback(
    (threadId: string, options: { userAction: boolean }) => {
      if (!editor) return;
      const tr = buildRemoveCommentAnchorTransaction(editor.state, threadId);
      if (!tr) return;
      if (!options.userAction) tr.setMeta('addToHistory', false);
      editor.view.dispatch(tr);
    },
    [editor],
  );

  // ── 划词评论: optimistic anchor, then persist under the same ids ──
  const beginComposeAt = useCallback(
    (point: CommentComposePoint) => {
      if (!editor || !canComment || composing || !editor.isEditable) return;
      const threadId = crypto.randomUUID();
      const commentId = crypto.randomUUID();
      const ranges = editor.state.selection.ranges.map(({ $from, $to }) => ({
        from: $from.pos,
        to: $to.pos,
      }));
      const tr = buildAddCommentSelectionTransaction(editor.state, threadId);
      if (!tr) return;
      editor.view.dispatch(tr);
      setComposing({ threadId, commentId, excerpt: anchorExcerpt(editor.state.doc, ranges) });
      setComposerError(null);
      setComposerAt(point);
    },
    [editor, canComment, composing],
  );
  useEffect(() => {
    if (!editor || !editor.isEditable || !canComment || composing) return;
    return bindSelectionCommentComposer(editor, beginComposeAt);
  }, [editor, canComment, composing, beginComposeAt]);

  const submitCompose = useCallback(
    async (bodyMd: string, kind: CommentThreadKind, mentions: string[]) => {
      if (!composing) return false;
      setComposerError(null);
      try {
        await createMutation.mutateAsync({
          pageId: scope.pageId,
          threadId: composing.threadId,
          commentId: composing.commentId,
          bodyMd,
          kind,
          mentions,
          anchorKind: 'selection',
          ...(composing.pdfAnchor ? { pdfAnchor: composing.pdfAnchor } : {}),
        });
        setComposing(null);
        setComposerAt(null);
        if (editor) selectCommentThread(editor.view, composing.threadId, { flash: true });
        pdf?.onSelectThread(composing.threadId);
        setRailOpen(true);
        return true;
      } catch (error: unknown) {
        // The optimistic anchor stays; retry resubmits the exact same ids.
        setComposerError({ cause: error });
        return false;
      }
    },
    [composing, createMutation, scope.pageId, editor, pdf, setRailOpen],
  );

  const cancelCompose = useCallback(() => {
    if (!composing) return;
    dispatchRemoveAnchor(composing.threadId, { userAction: true });
    setComposing(null);
    setComposerAt(null);
    setComposerError(null);
  }, [composing, dispatchRemoveAnchor]);

  const submitPageComment = useCallback(
    async (bodyMd: string, kind: CommentThreadKind, mentions: string[]) => {
      if (!canComment) return false;
      if (
        !pageDraft.current ||
        pageDraft.current.bodyMd !== bodyMd ||
        pageDraft.current.kind !== kind
      ) {
        pageDraft.current = {
          threadId: crypto.randomUUID(),
          commentId: crypto.randomUUID(),
          bodyMd,
          kind,
        };
      }
      pageCommentMutation.reset();
      try {
        await pageCommentMutation.mutateAsync({
          ...pageDraft.current,
          pageId: scope.pageId,
          mentions,
          anchorKind: 'page',
        });
        pageDraft.current = null;
        return true;
      } catch {
        return false;
      }
    },
    [canComment, pageCommentMutation, scope.pageId],
  );

  const handleLike = useCallback(
    async (commentId: string, liked: boolean) => {
      likeMutation.reset();
      try {
        await likeMutation.mutateAsync({ commentId, liked });
      } catch {
        /* The entry retains its current value and shows a retryable error. */
      }
    },
    [likeMutation],
  );

  const handleEdit = useCallback(
    async (commentId: string, bodyMd: string) => {
      editMutation.reset();
      try {
        await editMutation.mutateAsync({ commentId, bodyMd });
        return true;
      } catch {
        return false;
      }
    },
    [editMutation],
  );

  const handleCopyLink = useCallback(
    async (commentId: string) => {
      try {
        await navigator.clipboard.writeText(
          commentLink(
            window.location.href,
            { ...scope, knowledgeBaseId, source: 'server' },
            commentId,
          ),
        );
        return true;
      } catch {
        return false;
      }
    },
    [scope, knowledgeBaseId],
  );

  // ── Sidebar actions ──
  const locateThread = useCallback(
    (threadId: string) => {
      if (pdf) {
        const anchor = threads.find((thread) => thread.id === threadId)?.pdfAnchor;
        if (anchor?.assetHash === pdf.assetHash) {
          pdf.onSelectThread(threadId);
          pdf.onLocate(anchor);
        }
        return;
      }
      if (!editor) return;
      const anchor = collectCommentAnchors(editor.state.doc).find(
        (candidate) => candidate.threadId === threadId,
      );
      if (!anchor) return;
      selectCommentThread(editor.view, threadId, { flash: true });
      const from = anchor.ranges.reduce(
        (min, range) => Math.min(min, range.from),
        Number.MAX_SAFE_INTEGER,
      );
      const located = editor.view.domAtPos(from);
      const element =
        located.node.nodeType === 1 ? (located.node as HTMLElement) : located.node.parentElement;
      element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setActiveThreadId(threadId);
    },
    [editor, pdf, threads],
  );

  const handleReply = useCallback(
    async (target: CommentReplyTarget, bodyMd: string, mentions: string[]) => {
      replyMutation.reset();
      try {
        await replyMutation.mutateAsync({
          threadId: target.threadId,
          replyToCommentId: target.commentId,
          bodyMd,
          mentions,
        });
        setReplyTarget(null);
        return true;
      } catch {
        // Keep the reply draft and target available for retry.
        return false;
      }
    },
    [replyMutation],
  );

  const handleResolve = useCallback(
    async (threadId: string) => {
      reopenMutation.reset();
      resolveMutation.reset();
      try {
        await resolveMutation.mutateAsync(threadId);
      } catch {
        // Rendered on the card.
      }
    },
    [resolveMutation, reopenMutation],
  );

  const handleReopen = useCallback(
    async (threadId: string) => {
      resolveMutation.reset();
      reopenMutation.reset();
      try {
        await reopenMutation.mutateAsync(threadId);
      } catch {
        // Rendered on the card.
      }
    },
    [reopenMutation, resolveMutation],
  );

  const handleDeleteComment = useCallback(
    async (commentId: string) => {
      deleteMutation.reset();
      try {
        const result = await deleteMutation.mutateAsync(commentId);
        if (result.threadDeleted) {
          const thread = threads.find((candidate) =>
            candidate.comments.some((entry) => entry.id === commentId),
          );
          if (thread) dispatchRemoveAnchor(thread.id, { userAction: false });
        }
      } catch {
        // Rendered on the card.
      }
    },
    [deleteMutation, threads, dispatchRemoveAnchor],
  );

  const handleRemoveOrphan = useCallback(
    (threadId: string) => {
      dispatchRemoveAnchor(threadId, { userAction: true });
    },
    [dispatchRemoveAnchor],
  );

  function replyState(locale?: Locale) {
    const knowledgeT = createTranslator(knowledgeMessages, locale);
    return {
      pending: replyMutation.isPending,
      threadId: (replyMutation.variables?.threadId ?? null) as string | null,
      error: replyMutation.isError
        ? commentErrorText(replyMutation.error, knowledgeT('unableToSendReplyPleaseRetry'))
        : null,
    };
  }
  // Resolve and reopen share one card-level transition state: either pending
  // state disables both buttons of that thread, either failure renders on it.
  function resolveState(locale?: Locale) {
    const knowledgeT = createTranslator(knowledgeMessages, locale);
    return {
      pending: resolveMutation.isPending || reopenMutation.isPending,
      threadId: (resolveMutation.variables ?? reopenMutation.variables ?? null) as string | null,
      error: resolveMutation.isError
        ? commentErrorText(resolveMutation.error, knowledgeT('actionFailedPleaseRetry'))
        : reopenMutation.isError
          ? commentErrorText(reopenMutation.error, knowledgeT('actionFailedPleaseRetry'))
          : null,
    };
  }

  return (
    <div ref={sidebarHost} style={{ display: 'contents' }}>
      {composing && composerAt ? (
        <SelectionCommentPopover anchor={composerAt} excerpt={composing.excerpt}>
          <CommentComposer
            variant="popover"
            minHeight={90}
            knowledgeBaseId={scope.knowledgeBaseId}
            placeholder={knowledgeT('writeAComment')}
            submitLabel={knowledgeT('send')}
            sendingLabel={knowledgeT('sending')}
            sending={createMutation.isPending}
            error={
              composerError
                ? commentErrorText(
                    composerError.cause,
                    knowledgeT('unableToSendCommentPleaseRetry'),
                    locale,
                  )
                : null
            }
            allowIssue
            onSubmit={submitCompose}
            authors={authors}
            onCancel={cancelCompose}
          />
        </SelectionCommentPopover>
      ) : null}

      {railOpen ? (
        <CommentsSidebar
          knowledgeBaseId={scope.knowledgeBaseId}
          model={model}
          replyTarget={replyTarget}
          activeThreadId={activeThreadId}
          onRemoveOrphan={handleRemoveOrphan}
          status={threadsQuery.isPending ? 'loading' : threadsQuery.isError ? 'error' : 'ready'}
          errorText={commentErrorText(
            threadsQuery.error,
            knowledgeT('unableToLoadCommentsPleaseRetry'),
          )}
          onRetry={() => void threadsQuery.refetch()}
          onClose={() => setRailOpen(false)}
          canComment={canComment}
          currentUserId={currentUserId}
          authors={authors}
          create={{
            pending: pageCommentMutation.isPending,
            error: pageCommentMutation.isError
              ? commentErrorText(
                  pageCommentMutation.error,
                  knowledgeT('unableToSendCommentPleaseRetry'),
                )
              : null,
          }}
          onCreate={submitPageComment}
          like={{
            pending: likeMutation.isPending,
            commentId: likeMutation.variables?.commentId ?? null,
            error: likeMutation.isError
              ? commentErrorText(likeMutation.error, knowledgeT('unableToLikeCommentPleaseRetry'))
              : null,
          }}
          onLike={(commentId, liked) => void handleLike(commentId, liked)}
          edit={{
            pending: editMutation.isPending,
            commentId: editMutation.variables?.commentId ?? null,
            error: editMutation.isError
              ? commentErrorText(editMutation.error, knowledgeT('unableToSavePleaseRetry'))
              : null,
          }}
          onEdit={handleEdit}
          onCopyLink={handleCopyLink}
          reply={replyState(locale)}
          resolve={resolveState(locale)}
          deletingCommentId={deleteMutation.isPending ? (deleteMutation.variables ?? null) : null}
          deleteError={
            deleteMutation.isError
              ? {
                  commentId: deleteMutation.variables ?? null,
                  message: commentErrorText(
                    deleteMutation.error,
                    knowledgeT('unableToDeleteYourCommentWasKeptPlease'),
                  ),
                }
              : null
          }
          onLocate={locateThread}
          onReply={handleReply}
          onResolve={(threadId) => void handleResolve(threadId)}
          onReopen={(threadId) => void handleReopen(threadId)}
          onDeleteComment={(commentId) => void handleDeleteComment(commentId)}
          onReplyTargetChange={(target) => {
            if (!replyMutation.isPending) {
              replyMutation.reset();
              setReplyTarget(target);
            }
          }}
        />
      ) : null}
    </div>
  );
}

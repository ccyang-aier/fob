'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comments-sidebar.messages';
import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getOverlayRoot } from '@/lib/overlay-root';
import { ChatsCircle, WarningCircle, X } from '@phosphor-icons/react';
import type { CommentThreadKind } from '@fob/shared/knowledge/comments';
import {
  defaultCommentFilters,
  filterCommentGroups,
  type CommentSidebarModel,
} from '../comments-view-model';
import {
  CommentThreadCard,
  OrphanAnchorCard,
  type CommentThreadCardProps,
  type CommentReplyTarget,
} from './comment-thread-card';
import { CommentComposer } from './comment-composer';
import { CommentFilterControls } from './comment-filters';
import styles from './comments.module.css';

const narrowQuery = '(max-width: 700px)';
const readNarrowView = () => window.matchMedia(narrowQuery).matches;
function subscribeNarrowView(onChange: () => void) {
  const media = window.matchMedia(narrowQuery);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export interface CommentsSidebarProps extends Pick<
  CommentThreadCardProps,
  | 'knowledgeBaseId'
  | 'canComment'
  | 'currentUserId'
  | 'authors'
  | 'reply'
  | 'resolve'
  | 'deletingCommentId'
  | 'deleteError'
  | 'like'
  | 'onLike'
  | 'onLocate'
  | 'onResolve'
  | 'onReopen'
  | 'onDeleteComment'
  | 'edit'
  | 'onEdit'
  | 'onCopyLink'
> {
  model: CommentSidebarModel;
  replyTarget: CommentReplyTarget | null;
  onReplyTargetChange: (target: CommentReplyTarget | null) => void;
  onReply: (target: CommentReplyTarget, bodyMd: string, mentions: string[]) => Promise<boolean>;
  activeThreadId: string | null;
  onRemoveOrphan: (threadId: string) => void;
  status: 'loading' | 'error' | 'ready';
  errorText: string | null;
  onRetry: () => void;
  onClose: () => void;
  create: { pending: boolean; error: string | null };
  onCreate: (bodyMd: string, kind: CommentThreadKind, mentions: string[]) => Promise<boolean>;
}

export function CommentsSidebar({
  model,
  replyTarget,
  onReplyTargetChange,
  onReply,
  activeThreadId,
  onRemoveOrphan,
  status,
  errorText,
  onRetry,
  onClose,
  create,
  onCreate,
  ...card
}: CommentsSidebarProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const narrow = useSyncExternalStore(subscribeNarrowView, readNarrowView, () => false);
  // Locating a quoted comment clears filters so its thread is always visible.
  const [choice, setChoice] = useState({ activeThreadId, value: defaultCommentFilters });
  const filters = choice.activeThreadId === activeThreadId ? choice.value : defaultCommentFilters;
  const groups = filterCommentGroups([...model.groups, ...model.unanchored], filters);
  const filtered = Object.keys(filters).some(
    (key) =>
      filters[key as keyof typeof filters] !== defaultCommentFilters[key as keyof typeof filters],
  );
  const orphans = filtered ? [] : model.orphans;
  const replyEntry = [...model.groups, ...model.unanchored]
    .find((group) => group.threadId === replyTarget?.threadId)
    ?.thread.comments.find((entry) => entry.id === replyTarget?.commentId);
  const replyAuthor = replyEntry
    ? (card.authors?.get(replyEntry.authorId) ?? {
        name: card.currentUserId === replyEntry.authorId ? knowledgeT('me') : knowledgeT('members'),
      })
    : undefined;
  const replyComposer =
    card.canComment && replyEntry && replyTarget ? (
      <div key={replyTarget.commentId} className={styles.inlineReply}>
        <CommentComposer
          knowledgeBaseId={card.knowledgeBaseId}
          placeholder={knowledgeT('replyToValue', {
            v0: replyAuthor?.name ?? knowledgeT('members'),
          })}
          submitLabel={knowledgeT('sendReply')}
          sendingLabel={knowledgeT('sending')}
          sending={card.reply.pending}
          error={card.reply.threadId === replyTarget.threadId ? card.reply.error : null}
          replyTo={replyAuthor}
          authors={card.authors}
          onSubmit={(body, _kind, mentions) => onReply(replyTarget, body, mentions)}
          onCancel={() => onReplyTargetChange(null)}
          minHeight={36}
        />
      </div>
    ) : null;
  const sidebar = (
    <aside
      data-knowledge-comments
      aria-label={knowledgeT('pageComment')}
      className={styles.sidebar}
    >
      <header className={styles.header}>
        <h2 className={styles.heading}>{knowledgeT('comments')}</h2>
        {status === 'ready' && <span className={styles.count}>{model.counts.total}</span>}
        <button
          type="button"
          className={`${styles.iconButton} ${styles.close}`}
          aria-label={knowledgeT('collapseCommentsPanel')}
          title={knowledgeT('collapseCommentsPanel')}
          onClick={onClose}
        >
          <X size={16} aria-hidden />
        </button>
      </header>
      <CommentFilterControls
        value={filters}
        onChange={(value) => setChoice({ activeThreadId, value })}
      />
      <div className={styles.body} aria-label={knowledgeT('commentList')} tabIndex={0}>
        {status === 'loading' ? (
          <div role="status" aria-label={knowledgeT('loadingComments')}>
            {[0, 1, 2].map((index) => (
              <div key={index} className={styles.skeleton}>
                <span />
                <span />
                <span />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div role="alert" className={styles.status}>
            <WarningCircle size={24} aria-hidden />
            <strong>{knowledgeT('unableToLoadComments')}</strong>
            <p>{errorText}</p>
            <button type="button" className={styles.textButton} onClick={onRetry}>
              {knowledgeT('retry')}
            </button>
          </div>
        ) : !groups.length && !orphans.length ? (
          <div className={styles.status}>
            <ChatsCircle size={26} aria-hidden />
            <strong>
              {filtered ? knowledgeT('noMatchingComments') : knowledgeT('noCommentsYet')}
            </strong>
            <p>
              {filtered
                ? knowledgeT('tryAdjustingYourFilters')
                : card.canComment
                  ? knowledgeT('shareYourThoughtsOrPostAQuestionTo')
                  : knowledgeT('pageDiscussionsAppearHere')}
            </p>
            {filtered && (
              <button
                type="button"
                className={styles.textButton}
                onClick={() => setChoice({ activeThreadId, value: defaultCommentFilters })}
              >
                {knowledgeT('clearFilters')}
              </button>
            )}
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <CommentThreadCard
                key={group.threadId}
                group={group}
                active={activeThreadId === group.threadId}
                onStartReply={onReplyTargetChange}
                replyTarget={replyTarget}
                replyComposer={replyComposer}
                {...card}
              />
            ))}
            {!!orphans.length && (
              <section aria-label={knowledgeT('anchorWithoutAThread')}>
                <p className={styles.sectionLabel}>{knowledgeT('orphanedAnchor')}</p>
                {orphans.map((orphan) => (
                  <OrphanAnchorCard
                    key={orphan.threadId}
                    orphan={orphan}
                    canRemove={card.canComment}
                    onRemove={onRemoveOrphan}
                  />
                ))}
              </section>
            )}
          </>
        )}
      </div>
      <footer className={styles.footer}>
        {card.canComment ? (
          <CommentComposer
            knowledgeBaseId={card.knowledgeBaseId}
            placeholder={knowledgeT('writeACommentAndShareYourThoughts')}
            submitLabel={knowledgeT('post')}
            sendingLabel={knowledgeT('sending')}
            sending={create.pending}
            error={create.error}
            authors={card.authors}
            onSubmit={async (body, kind, mentions) => {
              const success = await onCreate(body, kind, mentions);
              if (success) setChoice({ activeThreadId, value: defaultCommentFilters });
              return success;
            }}
            allowIssue
            persistent
            autoFocus={false}
            minHeight={36}
          />
        ) : (
          <p className={styles.startHint}>
            {knowledgeT('yourPermissionsOnlyAllowViewingComments')}
          </p>
        )}
      </footer>
    </aside>
  );
  // The shell clips its main column; the mobile rail needs the overlay host.
  return narrow ? createPortal(sidebar, getOverlayRoot() ?? document.body) : sidebar;
}

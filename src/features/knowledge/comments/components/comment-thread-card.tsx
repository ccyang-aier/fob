'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comment-thread-card.messages';
import { ArrowUpRight, Chat, CheckCircle, WarningCircle, Quotes } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { CommentThreadGroup, OrphanAnchorGroup } from '../comments-view-model';
import { CommentEntryItem, type CommentAuthor } from './comment-entry';
import styles from './comments.module.css';

export type CommentReplyTarget = { threadId: string; commentId: string };

export interface CommentThreadCardProps {
  group: CommentThreadGroup;
  knowledgeBaseId: string;
  active: boolean;
  canComment: boolean;
  currentUserId: string | null;
  authors?: ReadonlyMap<string, CommentAuthor>;
  onStartReply: (target: CommentReplyTarget) => void;
  reply: { pending: boolean; threadId: string | null; error: string | null };
  resolve: { pending: boolean; threadId: string | null; error: string | null };
  deletingCommentId: string | null;
  deleteError?: { commentId: string | null; message: string } | null;
  like: { pending: boolean; commentId: string | null; error: string | null };
  onLike: (commentId: string, liked: boolean) => void;
  onLocate: (threadId: string) => void;
  onResolve: (threadId: string) => void;
  onReopen: (threadId: string) => void;
  onDeleteComment: (commentId: string) => void;
  edit: { pending: boolean; commentId: string | null; error: string | null };
  onEdit: (commentId: string, bodyMd: string) => Promise<boolean>;
  onCopyLink: (commentId: string) => Promise<boolean>;
  replyTarget?: CommentReplyTarget | null;
  replyComposer?: ReactNode;
}

export function CommentThreadCard({
  group,
  knowledgeBaseId,
  active,
  canComment,
  currentUserId,
  authors,
  onStartReply,
  reply,
  resolve,
  deletingCommentId,
  deleteError,
  like,
  onLike,
  onLocate,
  onResolve,
  onReopen,
  onDeleteComment,
  edit,
  onEdit,
  onCopyLink,
  replyTarget,
  replyComposer,
}: CommentThreadCardProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const resolved = group.resolved;
  const resolvePending = resolve.pending && resolve.threadId === group.threadId;
  const issue = group.thread.kind === 'issue';
  const quote =
    group.thread.anchorKind === 'selection' ? (
      <div className={styles.excerpt} data-unavailable={!group.anchor}>
        <Quotes size={16} weight="fill" aria-hidden />
        <div>
          <div className={styles.excerptHeading}>
            <span className={styles.excerptLabel}>{knowledgeT('quotedText')}</span>
            <button
              type="button"
              className={styles.locate}
              disabled={!group.anchor}
              onClick={() => onLocate(group.threadId)}
              title={
                group.anchor
                  ? knowledgeT('locateThisCommentInTheDocument')
                  : knowledgeT('originalTextNoLongerExists')
              }
            >
              {knowledgeT('locateOriginalText')}
              <ArrowUpRight size={13} aria-hidden />
            </button>
          </div>
          <p title={group.excerpt}>
            {group.excerpt || knowledgeT('theOriginalTextForThisCommentNoLonger')}
          </p>
        </div>
      </div>
    ) : undefined;
  return (
    <article
      className={styles.thread}
      data-comment-card={group.threadId}
      data-active={active}
      aria-label={knowledgeT('commentThreadValue', {
        v0:
          group.excerpt ||
          (group.thread.anchorKind === 'page'
            ? knowledgeT('pageComment')
            : knowledgeT('originalTextNoLongerExists')),
      })}
    >
      <div className={styles.entries}>
        {group.thread.comments.map((entry, index) => {
          const target = group.thread.comments.find(
            (comment) => comment.id === entry.replyToCommentId,
          );
          const replyTo =
            index > 0
              ? target
                ? authors?.get(target.authorId)?.name ||
                  (currentUserId === target.authorId ? knowledgeT('me') : knowledgeT('members'))
                : knowledgeT('deletedComment')
              : undefined;
          return (
            <CommentEntryItem
              key={entry.id}
              entry={entry}
              knowledgeBaseId={knowledgeBaseId}
              author={authors?.get(entry.authorId)}
              isOwn={currentUserId === entry.authorId}
              deleting={deletingCommentId === entry.id}
              canComment={canComment}
              isReply={index > 0}
              replyTo={replyTo}
              onDelete={onDeleteComment}
              onLike={onLike}
              liking={like.pending && like.commentId === entry.id}
              edit={{
                pending: edit.pending && edit.commentId === entry.id,
                error: edit.commentId === entry.id ? edit.error : null,
              }}
              onEdit={onEdit}
              onCopyLink={onCopyLink}
              composer={
                replyTarget?.threadId === group.threadId && replyTarget.commentId === entry.id
                  ? replyComposer
                  : undefined
              }
              quote={index === 0 ? quote : undefined}
              badge={
                index === 0 && issue ? (
                  <span className={styles.issueBadge} data-resolved={resolved}>
                    {resolved ? (
                      <CheckCircle size={14} weight="fill" />
                    ) : (
                      <WarningCircle size={14} weight="fill" />
                    )}
                    {resolved ? knowledgeT('resolved') : knowledgeT('unresolved')}
                  </span>
                ) : undefined
              }
              threadAction={
                index === 0 && issue && canComment ? (
                  <DropdownMenuItem
                    disabled={resolvePending}
                    onSelect={() => (resolved ? onReopen : onResolve)(group.threadId)}
                  >
                    <CheckCircle size={16} weight="bold" aria-hidden />
                    {resolvePending
                      ? resolved
                        ? knowledgeT('reopening')
                        : knowledgeT('updating')
                      : resolved
                        ? knowledgeT('reopen')
                        : knowledgeT('markAsResolved')}
                  </DropdownMenuItem>
                ) : undefined
              }
              action={
                <>
                  {canComment && (
                    <button
                      type="button"
                      className={styles.replyButton}
                      disabled={reply.pending}
                      onClick={() =>
                        onStartReply({ threadId: group.threadId, commentId: entry.id })
                      }
                    >
                      <Chat size={16} aria-hidden />
                      {knowledgeT('reply')}
                    </button>
                  )}
                  {index === 0 && issue && canComment && (
                    <button
                      type="button"
                      className={styles.resolve}
                      disabled={resolvePending}
                      aria-label={
                        resolved ? knowledgeT('reopenQuestion') : knowledgeT('resolveQuestion')
                      }
                      onClick={() => (resolved ? onReopen : onResolve)(group.threadId)}
                    >
                      <CheckCircle size={17} weight="bold" aria-hidden />
                      {resolvePending
                        ? knowledgeT('working')
                        : resolved
                          ? knowledgeT('reopen')
                          : knowledgeT('resolve')}
                    </button>
                  )}
                </>
              }
            />
          );
        })}
      </div>
      {like.error && group.thread.comments.some((entry) => entry.id === like.commentId) && (
        <p className={styles.error} role="alert">
          {like.error}
        </p>
      )}
      {resolve.error && resolve.threadId === group.threadId && (
        <p className={styles.error} role="alert">
          {resolve.error}
        </p>
      )}
      {deleteError && group.thread.comments.some((entry) => entry.id === deleteError.commentId) && (
        <p className={styles.error} role="alert">
          {deleteError.message}
        </p>
      )}
    </article>
  );
}

export function OrphanAnchorCard({
  orphan,
  onRemove,
  canRemove,
}: {
  orphan: OrphanAnchorGroup;
  canRemove: boolean;
  onRemove: (threadId: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  return (
    <article
      className={styles.orphan}
      data-comment-card={orphan.threadId}
      aria-label={knowledgeT('commentAnchorWithoutAThread')}
    >
      <p>{knowledgeT('thisAnchorHasNoCommentThreadTheOriginal')}</p>
      <p>{orphan.excerpt}</p>
      {canRemove && (
        <button
          type="button"
          className={styles.textButton}
          onClick={() => onRemove(orphan.threadId)}
        >
          {knowledgeT('removeAnchor')}
        </button>
      )}
    </article>
  );
}

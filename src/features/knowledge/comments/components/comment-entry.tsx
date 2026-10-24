'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comment-entry.messages';
import { useRef, useState, type ReactNode } from 'react';
import { DotsThree, TrashSimple, ThumbsUp, PencilSimple, LinkSimple } from '@phosphor-icons/react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { CommentEntry } from '@fob/shared/knowledge/comments';
import { formatCommentTime } from '../comments-view-model';
import { CommentAvatar, type CommentAuthor } from './comment-avatar';
import { CommentComposer } from './comment-composer';
import { CommentMarkdown } from './comment-markdown';
import styles from './comments.module.css';

export type { CommentAuthor } from './comment-avatar';

export interface CommentEntryItemProps {
  entry: CommentEntry;
  knowledgeBaseId: string;
  author?: CommentAuthor;
  isOwn: boolean;
  deleting: boolean;
  canComment: boolean;
  isReply?: boolean;
  action?: ReactNode;
  threadAction?: ReactNode;
  badge?: ReactNode;
  quote?: ReactNode;
  composer?: ReactNode;
  replyTo?: string;
  onDelete: (commentId: string) => void;
  onLike: (commentId: string, liked: boolean) => void;
  liking: boolean;
  edit: { pending: boolean; error: string | null };
  onEdit: (commentId: string, bodyMd: string) => Promise<boolean>;
  onCopyLink: (commentId: string) => Promise<boolean>;
}

export function CommentEntryItem({
  entry,
  knowledgeBaseId,
  author,
  isOwn,
  deleting,
  canComment,
  isReply,
  action,
  threadAction,
  badge,
  quote,
  composer,
  replyTo,
  onDelete,
  onLike,
  liking,
  edit,
  onEdit,
  onCopyLink,
}: CommentEntryItemProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [editing, setEditing] = useState(false);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'error'>('idle');
  const [likePulse, setLikePulse] = useState(0);
  const entryRef = useRef<HTMLElement>(null);
  return (
    <article
      ref={entryRef}
      className={styles.entry}
      data-reply={isReply}
      data-comment-id={entry.id}
    >
      <CommentAvatar author={author} />
      <div className={styles.entryContent}>
        <div className={styles.entryHeader}>
          <span className={styles.author} title={author?.name}>
            {author?.name || (isOwn ? knowledgeT('me') : knowledgeT('members'))}
          </span>
          <time className={styles.time} dateTime={entry.createdAt}>
            {formatCommentTime(entry.createdAt)}
          </time>
          {replyTo && (
            <span className={styles.replyTarget}>
              {knowledgeT('reply')} <span>{replyTo}</span>
            </span>
          )}
          {badge}
          <div className={styles.entryActions}>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label={knowledgeT('commentActions')}
                  disabled={deleting || edit.pending}
                >
                  <DotsThree size={18} weight="bold" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className={styles.entryMenu}
                onCloseAutoFocus={(event) => {
                  if (editing) {
                    event.preventDefault();
                    entryRef.current?.querySelector<HTMLElement>('[role="textbox"]')?.focus();
                  }
                }}
              >
                {isOwn && canComment && (
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(true);
                      setCopyStatus('idle');
                    }}
                  >
                    <PencilSimple size={16} weight="bold" aria-hidden />
                    {knowledgeT('edit')}
                  </DropdownMenuItem>
                )}
                {threadAction}
                <DropdownMenuItem
                  onSelect={() => {
                    void onCopyLink(entry.id).then((success) =>
                      setCopyStatus(success ? 'copied' : 'error'),
                    );
                  }}
                >
                  <LinkSimple size={16} weight="bold" aria-hidden />
                  {knowledgeT('copyLink')}
                </DropdownMenuItem>
                {isOwn && canComment && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => onDelete(entry.id)}
                      disabled={deleting}
                    >
                      <TrashSimple size={16} weight="bold" aria-hidden />
                      {knowledgeT('delete')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        {quote}
        {editing && isOwn && canComment ? (
          <div className={styles.editComposer}>
            <CommentComposer
              knowledgeBaseId={knowledgeBaseId}
              placeholder={knowledgeT('editComment')}
              initialBodyMd={entry.bodyMd}
              submitLabel={knowledgeT('save')}
              sendingLabel={knowledgeT('saving')}
              sending={edit.pending}
              error={edit.error}
              onCancel={() => setEditing(false)}
              onSubmit={async (body) => {
                const success = await onEdit(entry.id, body);
                if (success) setEditing(false);
                return success;
              }}
              minHeight={36}
            />
          </div>
        ) : (
          <div className={styles.entryBody}>
            <CommentMarkdown body={entry.bodyMd} knowledgeBaseId={knowledgeBaseId} />
          </div>
        )}
        <div className={styles.entryToolbar}>
          <button
            type="button"
            className={styles.likeButton}
            aria-label={entry.liked ? knowledgeT('unlike') : knowledgeT('like')}
            aria-pressed={entry.liked}
            disabled={!canComment || liking}
            onClick={() => {
              setLikePulse((pulse) => (entry.liked ? 0 : pulse + 1));
              onLike(entry.id, !entry.liked);
            }}
          >
            <span
              key={likePulse}
              className={styles.likeIcon}
              data-pulse={likePulse > 0}
              aria-hidden
            >
              <ThumbsUp size={16} weight={entry.liked ? 'fill' : 'regular'} />
            </span>
            <span>{entry.likeCount || knowledgeT('like2')}</span>
          </button>
          {action}
        </div>
        {copyStatus !== 'idle' && (
          <p
            className={copyStatus === 'error' ? styles.composerError : styles.copyStatus}
            role={copyStatus === 'error' ? 'alert' : 'status'}
          >
            {copyStatus === 'copied'
              ? knowledgeT('linkCopied')
              : knowledgeT('unableToCopyPleaseRetry')}
          </p>
        )}
      </div>
      {composer}
    </article>
  );
}

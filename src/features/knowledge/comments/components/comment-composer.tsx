'use client';

import { useUiMessage } from '../../ui-message';
import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './comment-composer.messages';
import { useEffect, useRef, useState } from 'react';
import {
  At,
  CircleNotch,
  Image as ImageIcon,
  LinkSimple,
  WarningCircle,
} from '@phosphor-icons/react';
import { commentBodySchema, type CommentThreadKind } from '@fob/shared/knowledge/comments';
import { CommentEditor, type CommentEditorHandle } from './comment-editor';
import { useAssetUploads } from '../../assets/use-asset-uploads';
import { UploadQueueItem } from '../../assets/components/upload-queue-item';
import { safeKnowledgeUrl } from '@fob/shared/knowledge/schema';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import type { CommentAuthor } from './comment-avatar';
import styles from './comments.module.css';

export interface CommentComposerProps {
  knowledgeBaseId: string;
  placeholder: string;
  submitLabel: string;
  sendingLabel: string;
  sending: boolean;
  error?: string | null;
  onSubmit: (
    bodyMd: string,
    kind: CommentThreadKind,
    mentions: string[],
  ) => void | Promise<boolean>;
  onCancel?: () => void;
  autoFocus?: boolean;
  minHeight?: number;
  allowIssue?: boolean;
  persistent?: boolean;
  replyTo?: CommentAuthor;
  focusKey?: string;
  authors?: ReadonlyMap<string, CommentAuthor>;
  initialBodyMd?: string;
  variant?: 'inline' | 'popover';
}

/** Shared write surface: drafts survive failures; formatted text remains Markdown. */
export function CommentComposer({
  knowledgeBaseId,
  placeholder,
  submitLabel,
  sendingLabel,
  sending,
  error,
  onSubmit,
  onCancel,
  autoFocus = true,
  minHeight = 36,
  allowIssue = false,
  persistent = false,
  replyTo,
  focusKey,
  authors,
  initialBodyMd = '',
  variant = 'inline',
}: CommentComposerProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [body, setBody] = useState(initialBodyMd);
  const [issue, setIssue] = useState(false);
  const [touched, setTouched] = useState(false);
  const [mentioned, setMentioned] = useState<string[]>([]);
  const [link, setLink] = useState('');
  const [linkInvalid, setLinkInvalid] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const ref = useRef<CommentEditorHandle>(null);
  const input = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const [imageError, setImageError] = useUiMessage(knowledgeMessages, null);
  const uploads = useAssetUploads({
    knowledgeBaseId,
    onUploaded: (asset) => ref.current?.insertImage(asset.hash, asset.name),
  });
  const activeUploads = uploads.items.filter(
    (item) => !['done', 'canceled', 'error'].includes(item.phase),
  );
  const uploading = activeUploads.length > 0;
  const uploadItems = useRef(uploads.items);
  useEffect(() => {
    uploadItems.current = uploads.items;
  }, [uploads.items]);
  const cancelUpload = uploads.cancel;
  useEffect(
    () => () => {
      for (const item of uploadItems.current) cancelUpload(item.id);
    },
    [cancelUpload],
  );
  const valid = commentBodySchema.safeParse(body.trim()).success;
  const submit = async () => {
    setTouched(true);
    if (!valid || sending || uploading || submitting.current) return;
    submitting.current = true;
    try {
      const mentions = mentioned.filter((id) => body.includes(`@${authors?.get(id)?.name}`));
      if (await onSubmit(body.trim(), issue ? 'issue' : 'comment', mentions)) {
        ref.current?.clear();
        uploads.clearFinished();
        setBody('');
        setIssue(false);
        setTouched(false);
        setMentioned([]);
      }
    } finally {
      submitting.current = false;
    }
  };
  const popover = variant === 'popover';
  const feedback = (
    <>
      {uploads.items.some((item) => item.phase !== 'done') && (
        <ul className={styles.uploadQueue} aria-label={knowledgeT('commentImageUpload')}>
          {uploads.items
            .filter((item) => item.phase !== 'done')
            .map((item) => (
              <UploadQueueItem
                key={item.id}
                item={item}
                onCancel={uploads.cancel}
                onRetry={uploads.retry}
                onRemove={uploads.remove}
              />
            ))}
        </ul>
      )}
      {imageError && (
        <p className={styles.composerError} role="alert">
          {imageError}
        </p>
      )}
      {touched && !valid && (
        <p className={styles.composerError}>
          <WarningCircle size={12} aria-hidden />
          {knowledgeT('commentsMustContain150000Characters')}
        </p>
      )}
      {error && (
        <p className={styles.composerError} role="alert">
          <WarningCircle size={12} aria-hidden />
          {error}
        </p>
      )}
    </>
  );
  return (
    <div
      className={styles.composer}
      data-persistent={persistent}
      data-comment-composer={popover ? '' : undefined}
    >
      {replyTo && (
        <div className={styles.composerHeading}>
          <span>
            {knowledgeT('reply')}
            <strong>{replyTo.name}</strong>
          </span>
          <button
            type="button"
            className={styles.cancelReply}
            disabled={sending}
            onClick={onCancel}
          >
            {knowledgeT('cancel')}
          </button>
        </div>
      )}
      <div className={styles.composerBox} data-comment-box={popover ? '' : undefined}>
        <div data-comment-writing={popover ? '' : undefined}>
          <CommentEditor
            ref={ref}
            knowledgeBaseId={knowledgeBaseId}
            initialBody={initialBodyMd}
            placeholder={placeholder}
            disabled={sending}
            autoFocus={autoFocus}
            focusKey={focusKey}
            minHeight={minHeight}
            onChange={setBody}
            onSubmit={() => void submit()}
            onCancel={onCancel}
          />
          {popover && (
            <>
              <div data-comment-feedback>{feedback}</div>
              <span className={styles.sendHint} data-comment-shortcut>
                {knowledgeT('ctrlEnterToSend')}
              </span>
            </>
          )}
        </div>
        <div className={styles.composerActions} data-comment-actions={popover ? '' : undefined}>
          <div className={styles.composeTools} data-comment-tools={popover ? '' : undefined}>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={sending || !authors?.size}
                  aria-label={knowledgeT('mentionMember')}
                  title={knowledgeT('mentionMember')}
                >
                  <At size={18} weight="regular" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-h-60 overflow-y-auto"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  ref.current?.focus();
                }}
              >
                {Array.from(authors ?? []).map(([id, author]) => (
                  <DropdownMenuItem
                    key={id}
                    onSelect={() => {
                      ref.current?.insertText(`@${author.name} `);
                      setMentioned((value) => [...new Set([...value, id])]);
                    }}
                  >
                    @{author.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              className={`fob-action ${styles.iconButton}`}
              disabled={sending || !knowledgeBaseId}
              aria-label={knowledgeT('uploadCommentImage')}
              title={knowledgeT('uploadImage')}
              onClick={() => input.current?.click()}
            >
              <ImageIcon size={18} weight="regular" aria-hidden />
            </button>
            <input
              ref={input}
              type="file"
              accept="image/*"
              multiple
              hidden
              aria-label={knowledgeT('chooseCommentImage')}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.some((file) => !file.type.startsWith('image/'))) {
                  setImageError({ key: 'chooseAnImageFile' });
                } else {
                  setImageError(null);
                  uploads.addFiles(files);
                }
                event.target.value = '';
              }}
            />
            <DropdownMenu
              modal={false}
              open={linkOpen}
              onOpenChange={(open) => {
                setLinkOpen(open);
                if (open) {
                  setLink('');
                  setLinkInvalid(false);
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={styles.iconButton}
                  disabled={sending}
                  aria-label={knowledgeT('insertCommentLink')}
                  title={knowledgeT('insertLink')}
                >
                  <LinkSimple size={18} weight="regular" aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                onCloseAutoFocus={(event) => {
                  event.preventDefault();
                  ref.current?.focus();
                }}
              >
                <form
                  className={styles.linkForm}
                  onSubmit={(event) => {
                    event.preventDefault();
                    const href = safeKnowledgeUrl(link.trim(), 'link');
                    if (!href) {
                      setLinkInvalid(true);
                      return;
                    }
                    ref.current?.insertLink(href);
                    setLinkOpen(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') event.stopPropagation();
                  }}
                >
                  <label>
                    {knowledgeT('linkAddress')}
                    <input
                      autoFocus
                      aria-label={knowledgeT('commentLinkAddress')}
                      placeholder="https://"
                      value={link}
                      onChange={(event) => {
                        setLink(event.target.value);
                        setLinkInvalid(false);
                      }}
                      aria-invalid={linkInvalid}
                    />
                  </label>
                  {linkInvalid && <p role="alert">{knowledgeT('enterAValidSafeLinkAddress')}</p>}
                  <button type="submit" className={styles.textButton}>
                    {knowledgeT('insertLink')}
                  </button>
                </form>
              </DropdownMenuContent>
            </DropdownMenu>
            {allowIssue && (
              <label className={styles.issueChoice}>
                <input
                  type="checkbox"
                  checked={issue}
                  disabled={sending}
                  onChange={(event) => setIssue(event.target.checked)}
                />
                {knowledgeT('markAsQuestion')}
              </label>
            )}
          </div>
          {popover ? (
            <div data-comment-submit>
              {onCancel && (
                <Button variant="ghost" size="sm" onClick={onCancel} disabled={sending}>
                  {knowledgeT('cancel')}
                </Button>
              )}
              <Button
                size="sm"
                loading={sending}
                disabled={uploading || !valid}
                onClick={() => void submit()}
                aria-label={sending ? sendingLabel : submitLabel}
              >
                {submitLabel}
              </Button>
            </div>
          ) : (
            <>
              <span className={styles.sendHint}>{knowledgeT('ctrlEnterToSend')}</span>
              <button
                type="button"
                className={styles.sendButton}
                onClick={() => void submit()}
                disabled={sending || uploading || !valid}
                aria-label={sending ? sendingLabel : submitLabel}
                title={`${submitLabel} · Ctrl / ⌘ + Enter`}
              >
                <span>{sending ? sendingLabel : submitLabel}</span>
                {sending && <CircleNotch size={15} className="animate-spin" aria-hidden />}
              </button>
            </>
          )}
        </div>
      </div>
      {!popover && feedback}
      {!popover && onCancel && !replyTo && (
        <button type="button" className={styles.cancelReply} disabled={sending} onClick={onCancel}>
          {knowledgeT('cancel')}
        </button>
      )}
    </div>
  );
}

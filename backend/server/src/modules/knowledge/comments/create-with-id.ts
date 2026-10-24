import { and, eq } from 'drizzle-orm';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { createCommentThreadInputSchema } from '@fob/shared/knowledge/comments';
import { asset, page, comment, commentThread } from '../../../platform/database/resources/schema';
import { isDeepStrictEqual } from 'node:util';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { requireCommentAccess } from './access';
import { KnowledgeCommentError } from './errors';
import { emitCommentThreadChanged, notifyCommentRecipients } from './notifications';
import type { CommentNotice } from './notifications';
import type { CommentRow, CommentThreadRow } from './queries';

/**
 * Client-id thread creation (N02): the frontend applies the CRDT `comment`
 * mark with a freshly generated threadId while the user is still composing,
 * so the anchor and the persisted thread must share that id — the mark cannot
 * be rebound after the fact without a second CRDT round trip. Retrying a lost
 * network response must not fork the thread either, so an existing
 * (knowledgeBase, threadId, pageId, commentId) match is an idempotent success.
 */
const createWithIdInputSchema = createCommentThreadInputSchema.safeExtend({ userId: entityIdSchema });

export interface CreateCommentThreadWithIdResult {
  thread: CommentThreadRow;
  comment: CommentRow;
  notified: string[];
  /** True when the exact thread and comment were already persisted (retry). */
  existing: boolean;
}

export async function createCommentThreadWithId(
  db: ResourceTransaction,
  input: unknown,
): Promise<CreateCommentThreadWithIdResult> {
  const parsed = createWithIdInputSchema.safeParse(input);
  if (!parsed.success) throw new KnowledgeCommentError('INVALID_COMMENT_INPUT');
  const { knowledgeBaseId, pageId, threadId, commentId, bodyMd, mentions, kind, anchorKind, pdfAnchor, userId } = parsed.data;
  const scope = { knowledgeBaseId, pageId };
  await requireCommentAccess(db, { userId, scope, required: 'comment' });
  if (pdfAnchor) {
    const [document] = await db.select({ properties: page.properties }).from(page).where(and(eq(page.knowledgeBaseId, knowledgeBaseId), eq(page.id, pageId)));
    const [file] = await db.select({ mime: asset.mime }).from(asset).where(and(eq(asset.knowledgeBaseId, knowledgeBaseId), eq(asset.hash, pdfAnchor.assetHash)));
    if (document?.properties.fileAsset !== `asset:${pdfAnchor.assetHash}` || file?.mime !== 'application/pdf') throw new KnowledgeCommentError('INVALID_COMMENT_INPUT');
  }

  const [existingThread] = await db.select().from(commentThread)
    .where(and(eq(commentThread.knowledgeBaseId, knowledgeBaseId), eq(commentThread.id, threadId)));
  if (existingThread) {
    // A retry of the same client operation: same page and same first comment
    // is success; anything else is id misuse, not a race to paper over.
    if (existingThread.pageId !== pageId || existingThread.kind !== kind || existingThread.anchorKind !== anchorKind || !isDeepStrictEqual(existingThread.pdfAnchor ?? undefined, pdfAnchor)) throw new KnowledgeCommentError('INVALID_COMMENT_INPUT');
    const [existingComment] = await db.select().from(comment)
      .where(and(eq(comment.knowledgeBaseId, knowledgeBaseId), eq(comment.id, commentId)));
    if (!existingComment || existingComment.threadId !== threadId || existingComment.authorId !== userId || existingComment.bodyMd !== bodyMd) throw new KnowledgeCommentError('INVALID_COMMENT_INPUT');
    return { thread: existingThread, comment: existingComment, notified: [], existing: true };
  }

  const [thread] = await db.insert(commentThread).values({ knowledgeBaseId, id: threadId, pageId, kind, anchorKind, pdfAnchor, status: kind === 'issue' ? 'open' : null }).returning();
  const [entry] = await db.insert(comment).values({
    knowledgeBaseId, id: commentId, threadId, authorId: userId, bodyMd,
  }).returning();
  const notices: CommentNotice[] = mentions.map((mentioned) => ({ kind: 'comment.mention', userId: mentioned }));
  const notified = await notifyCommentRecipients(db, { scope, threadId, commentId, actorId: userId, notices });
  await emitCommentThreadChanged(db, scope, threadId);
  return { thread, comment: entry, notified, existing: false };
}

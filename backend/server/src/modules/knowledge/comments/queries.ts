import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { entityIdSchema, pageScopeSchema } from '@fob/shared/knowledge/contracts';
import { comment, commentThread, commentLike } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { requireCommentAccess } from './access';
import { KnowledgeCommentError } from './errors';

export type CommentThreadRow = typeof commentThread.$inferSelect;
export type CommentRow = typeof comment.$inferSelect;
export type CommentWithLikes = CommentRow & { likeCount: number; liked: boolean };
export type CommentThreadWithComments = CommentThreadRow & { comments: CommentWithLikes[] };

const listInputSchema = pageScopeSchema.extend({ userId: entityIdSchema });

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KnowledgeCommentError('INVALID_COMMENT_INPUT');
  return parsed.data;
}

/**
 * Read-side listing for a page's comment sidebar. Threads anchor to the page;
 * block anchoring travels with the CRDT comment mark (N02). Comments return in
 * chronological order; the id tiebreaker keeps the order total even though
 * equal microsecond timestamps cannot occur through this one-comment-per-
 * transaction service.
 */
export async function listPageCommentThreads(db: ResourceTransaction, input: unknown): Promise<CommentThreadWithComments[]> {
  const parsed = parse(listInputSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  await requireCommentAccess(db, { userId: parsed.userId, scope, required: 'view' });
  const threads = await db.select().from(commentThread)
    .where(and(eq(commentThread.knowledgeBaseId, scope.knowledgeBaseId), eq(commentThread.pageId, scope.pageId)))
    .orderBy(asc(commentThread.createdAt), asc(commentThread.id));
  if (!threads.length) return [];
  const entries = await db.select().from(comment)
    .where(and(eq(comment.knowledgeBaseId, scope.knowledgeBaseId), inArray(comment.threadId, threads.map((thread) => thread.id))))
    .orderBy(asc(comment.createdAt), asc(comment.id));
  const likes = entries.length ? await db.select({
    commentId: commentLike.commentId,
    likeCount: sql<number>`count(*)::int`,
    liked: sql<boolean>`bool_or(${commentLike.userId} = ${parsed.userId})`,
  }).from(commentLike).where(and(eq(commentLike.knowledgeBaseId, scope.knowledgeBaseId), inArray(commentLike.commentId, entries.map(entry => entry.id)))).groupBy(commentLike.commentId) : [];
  const likesByComment = new Map(likes.map(like => [like.commentId, like]));
  const entriesByThread = new Map<string, CommentWithLikes[]>();
  for (const entry of entries) {
    const like = likesByComment.get(entry.id);
    const chain = entriesByThread.get(entry.threadId) ?? [];
    chain.push({ ...entry, likeCount: like?.likeCount ?? 0, liked: like?.liked ?? false });
    entriesByThread.set(entry.threadId, chain);
  }
  return threads.map(thread => ({ ...thread, comments: entriesByThread.get(thread.id) ?? [] }));
}

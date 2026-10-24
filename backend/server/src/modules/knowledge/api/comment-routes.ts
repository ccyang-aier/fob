import { TRPCError } from '@trpc/server';
import type {
  CommentEntry,
  CommentThread,
} from '@fob/shared/knowledge/comments';
import {
  commentThreadTargetInputSchema,
  createCommentThreadInputSchema,
  deleteOwnCommentInputSchema,
  listCommentThreadsInputSchema,
  replyCommentThreadInputSchema,
  setCommentLikeInputSchema,
  updateOwnCommentInputSchema,
} from '@fob/shared/knowledge/comments';
import { KnowledgeCommentError } from '../comments/errors';
import { createCommentThreadWithId } from '../comments/create-with-id';
import {
  deleteOwnComment,
  reopenCommentThread,
  replyCommentThread,
  resolveCommentThread,
  setCommentLike,
  updateOwnComment,
} from '../comments/mutations';
import { listPageCommentThreads } from '../comments/queries';
import type { CommentRow, CommentWithLikes, CommentThreadRow, CommentThreadWithComments } from '../comments/queries';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { apiError } from './errors';
import { knowledgeMutation, knowledgeQuery } from './procedures';

/** N01 service errors fold to the safe tRPC allowlist; unknown errors stay opaque. */
function toCommentTrpcError(error: unknown): TRPCError {
  if (error instanceof KnowledgeCommentError) {
    const code = ({
      INVALID_COMMENT_INPUT: 'BAD_REQUEST',
      COMMENT_ACCESS_DENIED: 'FORBIDDEN',
      COMMENT_THREAD_NOT_FOUND: 'NOT_FOUND',
      COMMENT_NOT_FOUND: 'NOT_FOUND',
    } as const)[error.code];
    return new TRPCError({ code });
  }
  return apiError(error);
}

function serializeEntry(row: CommentRow & Partial<Pick<CommentWithLikes, 'likeCount' | 'liked'>>): CommentEntry {
  return {
    knowledgeBaseId: row.knowledgeBaseId,
    id: row.id,
    threadId: row.threadId,
    authorId: row.authorId,
    replyToCommentId: row.replyToCommentId,
    bodyMd: row.bodyMd,
    likeCount: row.likeCount ?? 0,
    liked: row.liked ?? false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeThread(row: CommentThreadRow & { comments?: CommentRow[] }, comments?: CommentRow[]): CommentThread {
  return {
    knowledgeBaseId: row.knowledgeBaseId,
    id: row.id,
    pageId: row.pageId,
    kind: row.kind,
    anchorKind: row.anchorKind,
    ...(row.pdfAnchor ? { pdfAnchor: row.pdfAnchor } : {}),
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    comments: (comments ?? row.comments ?? []).map(serializeEntry),
  };
}

/**
 * The mutation services return thread rows without their comment chains; the
 * wire contract carries the full thread, so mutation results re-read the one
 * thread inside the same transaction (its own visibility already granted).
 */
async function serializeFullThread(db: ResourceTransaction, input: { knowledgeBaseId: string; pageId: string }, userId: string, threadId: string): Promise<CommentThread> {
  const threads: CommentThreadWithComments[] = await listPageCommentThreads(db, { ...input, userId });
  const found = threads.find((thread) => thread.id === threadId);
  if (!found) throw new TRPCError({ code: 'NOT_FOUND' });
  return serializeThread(found);
}

export const knowledgeCommentRouterRecord = {
  update: knowledgeMutation({
    input: updateOwnCommentInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const updated = await updateOwnComment(db, { ...input, userId: authority.userId });
        const thread = await serializeFullThread(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: updated.pageId }, authority.userId, updated.comment.threadId);
        return { comment: thread.comments.find(entry => entry.id === input.commentId)! };
      } catch (error) { throw toCommentTrpcError(error); }
    }),
  }),
  like: knowledgeMutation({
    input: setCommentLikeInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try { return await setCommentLike(db, { ...input, userId: authority.userId }); }
      catch (error) { throw toCommentTrpcError(error); }
    }),
  }),
  /** The sidebar list: threads with their reply chains, in creation order. */
  list: knowledgeQuery({
    input: listCommentThreadsInputSchema,
    scopes: ['read'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const threads: CommentThreadWithComments[] = await listPageCommentThreads(db, {
          knowledgeBaseId: input.knowledgeBaseId,
          pageId: input.pageId,
          userId: authority.userId,
        });
        return threads.map((thread) => serializeThread(thread));
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),

  /** Client-id creation: the CRDT anchor's threadId is the persisted thread's id. */
  create: knowledgeMutation({
    input: createCommentThreadInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const created = await createCommentThreadWithId(db, { ...input, userId: authority.userId });
        const thread = await serializeFullThread(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId }, authority.userId, created.thread.id);
        const entry = thread.comments.find(comment => comment.id === created.comment.id)!;
        return {
          thread,
          comment: entry,
          notified: created.notified,
          existing: created.existing,
        };
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),

  reply: knowledgeMutation({
    input: replyCommentThreadInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const replied = await replyCommentThread(db, { ...input, userId: authority.userId });
        return {
          thread: await serializeFullThread(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: replied.thread.pageId }, authority.userId, replied.thread.id),
          comment: serializeEntry(replied.comment),
          notified: replied.notified,
        };
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),

  resolve: knowledgeMutation({
    input: commentThreadTargetInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const resolved = await resolveCommentThread(db, { ...input, userId: authority.userId });
        return {
          thread: await serializeFullThread(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: resolved.thread.pageId }, authority.userId, resolved.thread.id),
          changed: resolved.changed,
        };
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),

  reopen: knowledgeMutation({
    input: commentThreadTargetInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        const reopened = await reopenCommentThread(db, { ...input, userId: authority.userId });
        return {
          thread: await serializeFullThread(db, { knowledgeBaseId: input.knowledgeBaseId, pageId: reopened.thread.pageId }, authority.userId, reopened.thread.id),
          changed: reopened.changed,
        };
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),

  /** Removing one's own comment; the client drops the anchor when the thread went with it. */
  delete: knowledgeMutation({
    input: deleteOwnCommentInputSchema,
    scopes: ['write'],
    resolve: ({ ctx, input }) => ctx.withResource(async (db, authority) => {
      try {
        return await deleteOwnComment(db, { ...input, userId: authority.userId });
      } catch (error) {
        throw toCommentTrpcError(error);
      }
    }),
  }),
};

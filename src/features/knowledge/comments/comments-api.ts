'use client';

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './comments-api.messages';

import {
  commentThreadSchema,
  setCommentLikeInputSchema,
  setCommentLikeResultSchema,
  commentThreadTransitionResultSchema,
  createCommentThreadInputSchema,
  createCommentThreadResultSchema,
  deleteOwnCommentInputSchema,
  deleteOwnCommentResultSchema,
  listCommentThreadsInputSchema,
  replyCommentThreadInputSchema,
  replyCommentThreadResultSchema,
  updateOwnCommentInputSchema,
  updateOwnCommentResultSchema,
} from '@fob/shared/knowledge/comments';
import type {
  CommentThread,
  CreateCommentThreadInput,
  SetCommentLikeResult,
  CommentThreadTransitionResult,
  CreateCommentThreadResult,
  DeleteOwnCommentResult,
  ReplyCommentThreadResult,
  UpdateOwnCommentResult,
} from '@fob/shared/knowledge/comments';
import { getFobApiOrigin } from '@/lib/fob-api-endpoint';
import { KnowledgeDataError, normalizeKnowledgeError } from '../data/errors';
import {
  createKnowledgeUntypedClientCache,
  type KnowledgeFetch,
  type KnowledgeUntypedTrpcClient,
} from '../data/trpc-client';

const knowledgeT = createTranslator(knowledgeMessages);

const threadListResultSchema = commentThreadSchema.array();

/** A response the shared contracts reject is an unavailable service, never data to render. */
function parseCommentPayload<T>(
  schema: { safeParse(payload: unknown): { success: true; data: T } | { success: false } },
  payload: unknown,
  procedure: string,
): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new KnowledgeDataError('UNAVAILABLE', {
      message: knowledgeT('invalidResponseFromCommentServiceValue', { v0: procedure }),
    });
  }
  return parsed.data;
}

/** Client-side mirrors of the shared input schemas fail fast as INVALID_REQUEST. */
function assertCommentInput(
  schema: { safeParse(payload: unknown): { success: true } | { success: false } },
  input: unknown,
  procedure: string,
): void {
  if (!schema.safeParse(input).success) {
    throw new KnowledgeDataError('INVALID_REQUEST', {
      message: knowledgeT('invalidCommentInputForValue', { v0: procedure }),
    });
  }
}

export type ReplyKnowledgeCommentInput = {
  threadId: string;
  replyToCommentId?: string;
  bodyMd: string;
  mentions?: string[];
};
export type CreateKnowledgeCommentInput = Omit<CreateCommentThreadInput, 'knowledgeBaseId'>;

export type KnowledgeCommentsApi = {
  updateComment(
    knowledgeBaseId: string,
    commentId: string,
    bodyMd: string,
  ): Promise<UpdateOwnCommentResult>;
  setLike(
    knowledgeBaseId: string,
    commentId: string,
    liked: boolean,
  ): Promise<SetCommentLikeResult>;
  listThreads(
    knowledgeBaseId: string,
    pageId: string,
    signal?: AbortSignal,
  ): Promise<CommentThread[]>;
  createThread(
    knowledgeBaseId: string,
    input: CreateKnowledgeCommentInput,
    signal?: AbortSignal,
  ): Promise<CreateCommentThreadResult>;
  replyThread(
    knowledgeBaseId: string,
    input: ReplyKnowledgeCommentInput,
    signal?: AbortSignal,
  ): Promise<ReplyCommentThreadResult>;
  resolveThread(
    knowledgeBaseId: string,
    threadId: string,
    signal?: AbortSignal,
  ): Promise<CommentThreadTransitionResult>;
  reopenThread(
    knowledgeBaseId: string,
    threadId: string,
    signal?: AbortSignal,
  ): Promise<CommentThreadTransitionResult>;
  deleteComment(
    knowledgeBaseId: string,
    commentId: string,
    signal?: AbortSignal,
  ): Promise<DeleteOwnCommentResult>;
};

/** Builds the comment surface over one transport: an origin resolver plus a fetch implementation. */
export function createKnowledgeCommentsApi(deps: {
  resolveOrigin: () => Promise<string> | string;
  fetchImpl?: KnowledgeFetch;
}): KnowledgeCommentsApi {
  const cache = createKnowledgeUntypedClientCache(deps.fetchImpl);
  const run = async <T>(
    knowledgeBaseId: string,
    signal: AbortSignal | undefined,
    invoke: (client: KnowledgeUntypedTrpcClient) => Promise<T>,
  ): Promise<T> => {
    try {
      const origin = await deps.resolveOrigin();
      return await invoke(cache.get(origin, knowledgeBaseId));
    } catch (cause) {
      throw normalizeKnowledgeError(cause, signal);
    }
  };

  return {
    async updateComment(knowledgeBaseId, commentId, bodyMd) {
      const wire = { knowledgeBaseId, commentId, bodyMd };
      assertCommentInput(updateOwnCommentInputSchema, wire, 'comment.update');
      const payload = await run(knowledgeBaseId, undefined, (client) =>
        client.mutation('comment.update', wire),
      );
      return parseCommentPayload(updateOwnCommentResultSchema, payload, 'comment.update');
    },
    async setLike(knowledgeBaseId, commentId, liked) {
      const wire = setCommentLikeInputSchema.parse({ knowledgeBaseId, commentId, liked });
      const payload = await run(knowledgeBaseId, undefined, (client) =>
        client.mutation('comment.like', wire),
      );
      return parseCommentPayload(setCommentLikeResultSchema, payload, 'comment.like');
    },
    async listThreads(knowledgeBaseId, pageId, signal) {
      const input = listCommentThreadsInputSchema.parse({ knowledgeBaseId, pageId });
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.query('comment.list', input, { signal }),
      );
      return parseCommentPayload(threadListResultSchema, payload, 'comment.list');
    },
    async createThread(knowledgeBaseId, input, signal) {
      const wire = { knowledgeBaseId, ...input, mentions: input.mentions ?? [] };
      assertCommentInput(createCommentThreadInputSchema, wire, 'comment.create');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('comment.create', wire, { signal }),
      );
      return parseCommentPayload(createCommentThreadResultSchema, payload, 'comment.create');
    },
    async replyThread(knowledgeBaseId, input, signal) {
      const wire = {
        knowledgeBaseId,
        threadId: input.threadId,
        replyToCommentId: input.replyToCommentId,
        bodyMd: input.bodyMd,
        mentions: input.mentions ?? [],
      };
      assertCommentInput(replyCommentThreadInputSchema, wire, 'comment.reply');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('comment.reply', wire, { signal }),
      );
      return parseCommentPayload(replyCommentThreadResultSchema, payload, 'comment.reply');
    },
    async resolveThread(knowledgeBaseId, threadId, signal) {
      const wire = { knowledgeBaseId, threadId };
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('comment.resolve', wire, { signal }),
      );
      return parseCommentPayload(commentThreadTransitionResultSchema, payload, 'comment.resolve');
    },
    async reopenThread(knowledgeBaseId, threadId, signal) {
      const wire = { knowledgeBaseId, threadId };
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('comment.reopen', wire, { signal }),
      );
      return parseCommentPayload(commentThreadTransitionResultSchema, payload, 'comment.reopen');
    },
    async deleteComment(knowledgeBaseId, commentId, signal) {
      const wire = { knowledgeBaseId, commentId };
      assertCommentInput(deleteOwnCommentInputSchema, wire, 'comment.delete');
      const payload = await run(knowledgeBaseId, signal, (client) =>
        client.mutation('comment.delete', wire, { signal }),
      );
      return parseCommentPayload(deleteOwnCommentResultSchema, payload, 'comment.delete');
    },
  };
}

/** The browser binding the React hooks call. */
export const knowledgeCommentsApi = createKnowledgeCommentsApi({
  resolveOrigin: () => getFobApiOrigin().then(({ origin }) => origin),
});

'use client';

/**
 * Comment thread queries and mutations (N02) under the U01 cache.
 *
 * One list query per page, keyed by extending the knowledgeBase `comments`
 * segment so B06 `comment.changed` events (another member's comment arriving
 * live) and every local mutation converge on the same refetch. Mutations do
 * not fabricate optimistic threads — the sidebar shows their real pending
 * state instead; the CRDT anchor is the only optimistic part of the loop.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeQueryKeys } from '../data/query-keys';
import { invalidateKnowledgeQueries } from '../data/query-client';
import { knowledgeCommentsApi } from './comments-api';
import type { CreateKnowledgeCommentInput, ReplyKnowledgeCommentInput } from './comments-api';

export function pageCommentThreadsKey(knowledgeBaseId: string, pageId: string) {
  return [...knowledgeQueryKeys.comments(knowledgeBaseId), 'page', pageId] as const;
}

export function usePageCommentThreads(knowledgeBaseId: string | null, pageId: string | null, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: pageCommentThreadsKey(knowledgeBaseId ?? 'none', pageId ?? 'none'),
    queryFn: ({ signal }) => knowledgeCommentsApi.listThreads(knowledgeBaseId!, pageId!, signal),
    enabled: (options.enabled ?? true) && knowledgeBaseId !== null && pageId !== null,
  });
}

function useCommentInvalidation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  return () => {
    return invalidateKnowledgeQueries(queryClient, knowledgeQueryKeys.comments(knowledgeBaseId));
  };
}

export function useCreateCommentThread(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: CreateKnowledgeCommentInput) => knowledgeCommentsApi.createThread(knowledgeBaseId, input),
    onSuccess: invalidate,
  });
}

export function useReplyCommentThread(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: ReplyKnowledgeCommentInput) => knowledgeCommentsApi.replyThread(knowledgeBaseId, input),
    onSuccess: invalidate,
  });
}

export function useResolveCommentThread(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (threadId: string) => knowledgeCommentsApi.resolveThread(knowledgeBaseId, threadId),
    onSuccess: invalidate,
  });
}

export function useReopenCommentThread(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (threadId: string) => knowledgeCommentsApi.reopenThread(knowledgeBaseId, threadId),
    onSuccess: invalidate,
  });
}

export function useDeleteComment(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (commentId: string) => knowledgeCommentsApi.deleteComment(knowledgeBaseId, commentId),
    onSuccess: invalidate,
  });
}

export function useSetCommentLike(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: { commentId: string; liked: boolean }) => knowledgeCommentsApi.setLike(knowledgeBaseId, input.commentId, input.liked),
    onSuccess: invalidate,
  });
}

export function useUpdateComment(knowledgeBaseId: string) {
  const invalidate = useCommentInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (input: { commentId: string; bodyMd: string }) => knowledgeCommentsApi.updateComment(knowledgeBaseId, input.commentId, input.bodyMd),
    onSuccess: invalidate,
  });
}

'use client';

/**
 * Notification inbox queries and mutations (N03) under the U01 cache.
 *
 * Both reads extend the knowledgeBase `notifications` segment, so the B06
 * `notification.created` invalidation (already wired by the knowledge
 * workbench's knowledge-base-event subscription) refetches the bell badge and the
 * list live; mutations invalidate the same namespace, converging local writes
 * and remote events on one loop.
 */

import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeQueryKeys } from '../data/query-keys';
import { invalidateKnowledgeQueries } from '../data/query-client';
import { knowledgeNotificationsApi } from './notifications-api';
import { publishKnowledgeNotifications } from './notifications-bridge';

export function notificationInboxKey(knowledgeBaseId: string) {
  return [...knowledgeQueryKeys.notifications(knowledgeBaseId), 'inbox'] as const;
}

export function notificationUnreadCountKey(knowledgeBaseId: string) {
  return [...knowledgeQueryKeys.notifications(knowledgeBaseId), 'unread'] as const;
}

export function useKnowledgeNotificationInbox(knowledgeBaseId: string | null, options: { limit?: number } = {}) {
  return useQuery({
    queryKey: [...notificationInboxKey(knowledgeBaseId ?? 'none'), options.limit ?? 30],
    queryFn: ({ signal }) => knowledgeNotificationsApi.listInbox(knowledgeBaseId!, { limit: options.limit }, signal),
    enabled: knowledgeBaseId !== null,
  });
}

export function useKnowledgeNotificationUnreadCount(knowledgeBaseId: string | null) {
  return useQuery({
    queryKey: notificationUnreadCountKey(knowledgeBaseId ?? 'none'),
    queryFn: ({ signal }) => knowledgeNotificationsApi.unreadCount(knowledgeBaseId!, signal),
    enabled: knowledgeBaseId !== null,
  });
}

function useNotificationInvalidation(knowledgeBaseId: string) {
  const queryClient = useQueryClient();
  return () => {
    void invalidateKnowledgeQueries(queryClient, knowledgeQueryKeys.notifications(knowledgeBaseId));
  };
}

export function useMarkNotificationRead(knowledgeBaseId: string) {
  const invalidate = useNotificationInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: (notificationId: string) => knowledgeNotificationsApi.markRead(knowledgeBaseId, notificationId),
    onSuccess: invalidate,
  });
}

export function useMarkAllNotificationsRead(knowledgeBaseId: string) {
  const invalidate = useNotificationInvalidation(knowledgeBaseId);
  return useMutation({
    mutationFn: () => knowledgeNotificationsApi.markAllRead(knowledgeBaseId),
    onSuccess: invalidate,
  });
}

/**
 * Publishes the workbench's live notification state to the shell bell. Mount
 * once inside the knowledge tree (under KnowledgeQueryProvider) with the
 * active knowledgeBase and the page-selection callback; `active: false` or unmount
 * retracts the snapshot and the bell falls back to its inert state.
 */
export function useKnowledgeNotificationsBridge(input: { active: boolean; knowledgeBaseId: string | null; openPage: (pageId: string | null) => void }) {
  const effectiveKnowledgeBaseId = input.active ? input.knowledgeBaseId : null;
  const inbox = useKnowledgeNotificationInbox(effectiveKnowledgeBaseId);
  const { mutate: mutateRead } = useMarkNotificationRead(effectiveKnowledgeBaseId ?? 'none');
  const { mutate: mutateAll } = useMarkAllNotificationsRead(effectiveKnowledgeBaseId ?? 'none');

  // Keep the jump target fresh without republishing on every parent render;
  // the stable closure reads the ref when the bell actually fires.
  const openPageRef = useRef(input.openPage);
  useEffect(() => {
    openPageRef.current = input.openPage;
  });
  const openPage = useCallback((pageId: string | null) => openPageRef.current(pageId), []);
  const runMarkRead = useCallback((notificationId: string) => void mutateRead(notificationId), [mutateRead]);
  const runMarkAll = useCallback(() => void mutateAll(), [mutateAll]);

  const { data, status } = inbox;
  useEffect(() => {
    if (!effectiveKnowledgeBaseId) {
      publishKnowledgeNotifications(null);
      return;
    }
    publishKnowledgeNotifications({
      knowledgeBaseId: effectiveKnowledgeBaseId,
      status: status === 'pending' ? 'loading' : status === 'error' ? 'error' : 'ready',
      items: data?.items ?? [],
      unreadCount: data?.unreadCount ?? 0,
      markRead: runMarkRead,
      markAllRead: runMarkAll,
      openPage,
    });
    return () => publishKnowledgeNotifications(null);
  }, [effectiveKnowledgeBaseId, data, status, openPage, runMarkRead, runMarkAll]);
}

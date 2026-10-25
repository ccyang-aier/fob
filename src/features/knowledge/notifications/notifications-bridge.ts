'use client';

/**
 * The knowledge → shell notification bridge (N03).
 *
 * The bell trigger lives in the workbench system bar, which is outside the
 * knowledge tree (its QueryClient, session and page-selection state). Instead
 * of duplicating any of that at the shell, the knowledge workbench publishes
 * one immutable snapshot per state change and the bell renders it through
 * `useSyncExternalStore`. Publishing null (knowledgeBase switch, unmount) renders
 * the bell inert — it never invents data.
 */

import type { NotificationItem } from '@fob/shared/knowledge/notifications';

export interface KnowledgeNotificationsBridgeSnapshot {
  knowledgeBaseId: string;
  status: 'loading' | 'ready' | 'error';
  /** The freshest inbox page the workbench holds. */
  items: readonly NotificationItem[];
  unreadCount: number;
  markRead(notificationId: string): void;
  markAllRead(): void;
  /** Jumps the knowledge canvas to a page (the notification's anchor). */
  openPage(pageId: string | null): void;
  openFolder?(folderId: string): void;
}

type Listener = () => void;

let current: KnowledgeNotificationsBridgeSnapshot | null = null;
let currentOwner: symbol | null = null;
const listeners = new Set<Listener>();

/** Replaces the snapshot; a stable reference between publishes keeps `useSyncExternalStore` calm. */
export function publishKnowledgeNotifications(snapshot: KnowledgeNotificationsBridgeSnapshot | null): void {
  currentOwner = null;
  current = snapshot;
  for (const listener of listeners) listener();
}

/** A hidden/unmounting tab can retract only the state it actually published. */
export function createKnowledgeNotificationsPublisher() {
  const owner = Symbol('knowledge-notifications');
  return {
    publish(snapshot: KnowledgeNotificationsBridgeSnapshot) {
      currentOwner = owner;
      current = snapshot;
      for (const listener of listeners) listener();
    },
    clear() {
      if (currentOwner !== owner) return;
      currentOwner = null;
      current = null;
      for (const listener of listeners) listener();
    },
  };
}

export function readKnowledgeNotifications(): KnowledgeNotificationsBridgeSnapshot | null {
  return current;
}

export function subscribeKnowledgeNotifications(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test seam: forget the published state between cases. */
export function resetKnowledgeNotificationsBridge(): void {
  publishKnowledgeNotifications(null);
}

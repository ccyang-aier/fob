import { afterEach, describe, expect, test } from 'bun:test';
import { createKnowledgeNotificationsPublisher, publishKnowledgeNotifications, readKnowledgeNotifications, resetKnowledgeNotificationsBridge, subscribeKnowledgeNotifications } from './notifications-bridge';
import { notificationInboxKey, notificationUnreadCountKey } from './notifications-queries';
import { knowledgeQueryKeys } from '../data/query-keys';
import { invalidationSegmentsForEvent } from '../collaboration/knowledge-base-events';
import { knowledgeKeysForSegments } from '../data/invalidation';

/**
 * The shell bridge contract (N03): publish/subscribe/clear semantics with a
 * stable snapshot reference, plus the realtime wiring proof — a §5.3
 * `notification.created` event invalidates exactly the query keys the inbox
 * and badge live under.
 */

afterEach(() => resetKnowledgeNotificationsBridge());

function snapshot(overrides: Partial<NonNullable<ReturnType<typeof readKnowledgeNotifications>>> = {}) {
  return {
    knowledgeBaseId: '20000000-0000-4000-8000-000000000000',
    status: 'ready' as const,
    items: [],
    unreadCount: 0,
    markRead: () => {},
    markAllRead: () => {},
    openPage: () => {},
    ...overrides,
  };
}

describe('notifications bridge', () => {
  test('starts inert and publishes notify-once snapshots', () => {
    expect(readKnowledgeNotifications()).toBeNull();
    const seen: Array<unknown> = [];
    const unsubscribe = subscribeKnowledgeNotifications(() => seen.push(readKnowledgeNotifications()));
    const first = snapshot();
    publishKnowledgeNotifications(first);
    expect(readKnowledgeNotifications()).toBe(first);
    expect(seen).toEqual([first]);
    unsubscribe();
  });

  test('a cleared bridge (knowledgeBase switch or unmount) notifies and reads back null', () => {
    publishKnowledgeNotifications(snapshot());
    let cleared = false;
    const unsubscribe = subscribeKnowledgeNotifications(() => { cleared = readKnowledgeNotifications() === null; });
    publishKnowledgeNotifications(null);
    expect(cleared).toBe(true);
    expect(readKnowledgeNotifications()).toBeNull();
    unsubscribe();
  });

  test('unsubscribed listeners go quiet', () => {
    let calls = 0;
    const unsubscribe = subscribeKnowledgeNotifications(() => { calls += 1; });
    unsubscribe();
    publishKnowledgeNotifications(snapshot());
    expect(calls).toBe(0);
  });

  test('closing an old tab cannot clear the active tab notification snapshot', () => {
    const oldTab = createKnowledgeNotificationsPublisher();
    const activeTab = createKnowledgeNotificationsPublisher();
    oldTab.publish(snapshot());
    const active = snapshot({ knowledgeBaseId: '30000000-0000-4000-8000-000000000000', unreadCount: 3 });
    activeTab.publish(active);
    oldTab.clear();
    expect(readKnowledgeNotifications()).toBe(active);
    activeTab.clear();
    expect(readKnowledgeNotifications()).toBeNull();
  });
});

describe('notifications realtime wiring', () => {
  test('notification.created events invalidate the inbox and badge key namespace', () => {
    const knowledgeBaseId = '20000000-0000-4000-8000-000000000000';
    const segments = invalidationSegmentsForEvent({ type: 'notification.created' });
    const keys = knowledgeKeysForSegments(knowledgeBaseId, segments);
    const root = knowledgeQueryKeys.notifications(knowledgeBaseId).join('/');
    expect(keys.some((key) => key.join('/') === root)).toBe(true);
    // Both live reads extend that root, so the single invalidation refetches them together.
    expect(notificationInboxKey(knowledgeBaseId).slice(0, 3).join('/')).toBe(root);
    expect(notificationUnreadCountKey(knowledgeBaseId).slice(0, 3).join('/')).toBe(root);
  });
});

import { describe, expect, test } from 'bun:test';
import type { NotificationItem } from '@fob/shared/knowledge/notifications';
import {
  deriveNotificationRows,
  formatNotificationTime,
  notificationBadgeText,
  notificationSubtitle,
  notificationVerb,
} from './notifications-view-model';

/** The bell's pure derivations: per-kind copy, relative time, unread state, badge label. */

const knowledgeBase = '20000000-0000-4000-8000-000000000000';
const base = {
  knowledgeBaseId: knowledgeBase,
  id: '30000000-0000-4000-8000-000000000001',
  pageId: '10000000-0000-4000-8000-000000000001',
  page: { id: '10000000-0000-4000-8000-000000000001', title: '设计规范' },
  actor: { id: '50000000-0000-4000-8000-000000000000', name: '林澜' },
  payload: { threadId: '10000000-0000-4000-8000-00000000000a', commentId: '10000000-0000-4000-8000-00000000000b', actorId: '50000000-0000-4000-8000-000000000000' },
  createdAt: '2026-09-26T08:00:00+00:00',
};

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({ ...base, kind: 'comment.mention', readAt: null, ...overrides } as NotificationItem);

describe('notifications view-model · rows', () => {
  test('derives rows with kind copy, page label, unread state and jump target', () => {
    const now = new Date('2026-09-26T08:05:00+00:00');
    const rows = deriveNotificationRows([
      item(),
      item({ id: '30000000-0000-4000-8000-000000000002', kind: 'comment.reply', readAt: '2026-09-26T08:30:00+00:00', actor: { id: '5', name: '  ' } }),
      item({ id: '30000000-0000-4000-8000-000000000003', page: null, pageId: null }),
    ], now);
    expect(rows[0]).toMatchObject({ unread: true, actorName: '林澜', pageLabel: '设计规范', targetPageId: base.pageId, timeText: '5 分钟前' });
    expect(rows[1]).toMatchObject({ unread: false, actorName: '有人', timeText: '5 分钟前' });
    // A page-less notice stays renderable but has nowhere to jump.
    expect(rows[2]).toMatchObject({ pageLabel: '知识库页面', targetPageId: null });
  });

  test('notificationVerb distinguishes the two comment kinds', () => {
    expect(notificationVerb('comment.reply')).toBe('回复了你参与的评论');
    expect(notificationVerb('comment.mention')).toBe('在评论中提到了你');
  });
});

describe('notifications view-model · time', () => {
  // Naive local ISO strings keep the calendar buckets machine-timezone independent.
  const now = new Date('2026-09-26T14:05:00');
  test('relative buckets then calendar fallbacks', () => {
    const at = (iso: string) => formatNotificationTime(iso, now);
    expect(at('2026-09-26T14:04:30')).toBe('刚刚');
    expect(at('2026-09-26T13:58:00')).toBe('7 分钟前');
    expect(at('2026-09-26T12:05:00')).toBe('12:05');
    expect(at('2026-09-25T09:12:00')).toBe('昨天 09:12');
    expect(at('2026-08-30T14:00:00')).toBe('8月30日 14:00');
    expect(at('2025-08-30T14:00:00')).toBe('2025年8月30日');
    expect(at('not a time')).toBe('');
  });
});

describe('notifications view-model · badge', () => {
  test('empty for none, exact up to 99, capped after', () => {
    expect(notificationBadgeText(0)).toBe('');
    expect(notificationBadgeText(3)).toBe('3');
    expect(notificationBadgeText(99)).toBe('99');
    expect(notificationBadgeText(100)).toBe('99+');
    expect(notificationBadgeText(Number.NaN)).toBe('');
  });

  test('header subtitle mirrors the unread count', () => {
    expect(notificationSubtitle(2)).toBe('2 条未读');
    expect(notificationSubtitle(0)).toBe('暂无未读');
  });
});

test('subscription notices retain the correct article or folder target and action copy', () => {
  const changed = item({ kind: 'page.changed', payload: { actorId: base.actor.id, teamspaceId: base.pageId, change: 'updated' } });
  const folder = item({ kind: 'folder.changed', pageId: null, page: null, folder: { id: base.pageId, name: 'Current folder name' }, payload: { actorId: base.actor.id, teamspaceId: base.pageId, change: 'renamed' } });
  const [articleRow, folderRow] = deriveNotificationRows([changed, folder]);
  expect(articleRow.targetPageId).toBe(base.pageId); expect(articleRow.targetFolderId).toBeUndefined();
  expect(notificationVerb(articleRow.kind, 'zh-CN', articleRow.change)).toBe('更新了你订阅的文档');
  expect(folderRow.targetPageId).toBeNull(); expect(folderRow.targetFolderId).toBe(base.pageId);
  expect(folderRow.pageLabel).toBe('Current folder name');
  expect(notificationVerb(folderRow.kind)).toBe('重命名了你订阅的文件夹');
});

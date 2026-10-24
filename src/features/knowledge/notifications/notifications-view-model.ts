import { createTranslator, formatDate, getLocale, plural, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './notifications-view-model.messages';
/**
 * The notification bell view-model (N03): pure derivations from inbox items to
 * the rows the popover renders — per-kind copy with actor and page, compact
 * relative time, unread state and the badge label. No React, no DOM, so every
 * rule below is decidable in a plain test.
 */

import type { NotificationItem, NotificationKind } from '@fob/shared/knowledge/notifications';

export interface NotificationRowModel {
  id: string;
  kind: NotificationKind;
  unread: boolean;
  /** The acting member's display name, falling back to an anonymous copy. */
  actorName: string;
  /** Page label for the second line; comment notices always anchor a page. */
  pageLabel: string;
  /** Where a click navigates; null when there is nothing to open. */
  targetPageId: string | null;
  timeText: string;
  createdAt: string;
}

export function actorNameOf(item: NotificationItem, locale: Locale = getLocale()): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return item.actor?.name?.trim() || knowledgeT('someone');
}

export function pageLabelOf(item: NotificationItem, locale: Locale = getLocale()): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return item.page?.title?.trim() || knowledgeT('knowledgeBasePage');
}

/** Per-kind action copy: 「回复了你参与的评论」 / 「在评论中提到了你」. */
export function notificationVerb(kind: NotificationKind, locale: Locale = getLocale()): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return kind === 'comment.reply'
    ? knowledgeT('repliedToACommentYouParticipateIn')
    : knowledgeT('mentionedYouInAComment');
}

/** Compact clock time: 刚刚 · 5 分钟前 · 14:05 · 昨天 09:12 · 8月30日 14:00. */
export function formatNotificationTime(
  iso: string,
  now: Date = new Date(),
  locale: Locale = getLocale(),
): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return knowledgeT('justNow');
  if (minutes < 60)
    return knowledgeT(
      plural(minutes, { one: 'oneMinuteAgo', other: 'valueMinutesAgo' }, locale) as
        'oneMinuteAgo' | 'valueMinutesAgo',
      { v0: minutes },
    );
  const clock = formatDate(at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, locale);
  const sameDay = (left: Date, right: Date) =>
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate();
  if (sameDay(at, now)) return clock;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(at, yesterday)) return knowledgeT('yesterdayValue', { v0: clock });
  if (at.getFullYear() === now.getFullYear())
    return `${formatDate(at, { month: 'long', day: 'numeric' }, locale)} ${clock}`;
  return formatDate(at, { year: 'numeric', month: 'long', day: 'numeric' }, locale);
}

/** Badge text: empty for zero, the exact count up to 99, then 99+. */
export function notificationBadgeText(unreadCount: number): string {
  if (!Number.isFinite(unreadCount) || unreadCount <= 0) return '';
  return unreadCount > 99 ? '99+' : String(unreadCount);
}

export function deriveNotificationRows(
  items: readonly NotificationItem[],
  now: Date = new Date(),
  locale: Locale = getLocale(),
): NotificationRowModel[] {
  return items.map((item) => ({
    id: item.id,
    kind: item.kind,
    unread: item.readAt === null,
    actorName: actorNameOf(item, locale),
    pageLabel: pageLabelOf(item, locale),
    targetPageId: item.pageId,
    timeText: formatNotificationTime(item.createdAt, now, locale),
    createdAt: item.createdAt,
  }));
}

/** Header copy under the panel title: 「3 条未读」 / 「暂无未读」. */
export function notificationSubtitle(unreadCount: number, locale: Locale = getLocale()): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return unreadCount > 0
    ? knowledgeT('valueUnread', { v0: unreadCount })
    : knowledgeT('noUnreadNotifications');
}

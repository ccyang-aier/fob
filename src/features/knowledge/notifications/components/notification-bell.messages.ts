import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  notifications: ['通知', 'Notifications'],
  openAKnowledgeBaseToViewNotifications: [
    '打开知识库后可查看通知',
    'Open a knowledge base to view notifications',
  ],
  valueUnreadNotifications: ['{v0} 条未读通知', '{v0} unread notifications'],
  oneUnreadNotification: ['{v0} 条未读通知', '{v0} unread notification'],
  live: ['实时', 'Live'],
  loadingNotifications: ['正在加载通知…', 'Loading notifications…'],
  notificationsAreUnavailableRetryingAutomatically: [
    '通知暂时不可用，稍后自动重试',
    'Notifications are unavailable. Retrying automatically.',
  ],
  noNotifications: ['暂无通知', 'No notifications'],
  commentRepliesAndMentionsAppearHereInReal: [
    '评论中的回复与提及会实时出现在这里',
    'Comment replies and mentions appear here in real time',
  ],
  valueValueOnPageValue: ['{v0} {v1}，来自页面 {v2}', '{v0} {v1} on page {v2}'],
  markAsRead: ['标为已读', 'Mark as read'],
  markNotificationFromValueAsRead: [
    '将 {v0} 的通知标为已读',
    'Mark notification from {v0} as read',
  ],
  working: ['处理中…', 'Working…'],
  markAllAsRead: ['全部标为已读', 'Mark all as read'],
});

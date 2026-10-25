import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  notifications: ['通知', 'Notifications'],
  openAKnowledgeBaseToViewNotifications: [
    '选择团队知识库后可查看通知',
    'Select a team knowledge base to view notifications',
  ],
  valueUnreadNotifications: ['{v0} 条未读通知', '{v0} unread notifications'],
  oneUnreadNotification: ['{v0} 条未读通知', '{v0} unread notification'],
  loadingNotifications: ['正在加载通知…', 'Loading notifications…'],
  notificationsAreUnavailable: [
    '通知暂时不可用，请稍后重试',
    'Notifications are unavailable. Try again later.',
  ],
  noNotifications: ['暂无通知', 'No notifications'],
  commentRepliesAndMentionsAppearHereInReal: [
    '订阅更新、评论回复与提及会出现在这里',
    'Updates you follow, replies and mentions appear here',
  ],
  valueValueOnPageValue: ['{v0} {v1}，{v2}', '{v0} {v1}, {v2}'],
  markAsRead: ['标为已读', 'Mark as read'],
  markNotificationFromValueAsRead: [
    '将 {v0} 的通知标为已读',
    'Mark notification from {v0} as read',
  ],
  working: ['处理中…', 'Working…'],
  markAllAsRead: ['全部标为已读', 'Mark all as read'],
});

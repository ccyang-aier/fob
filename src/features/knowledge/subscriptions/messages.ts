import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  subscribe: ['订阅更新', 'Subscribe to updates'], unsubscribe: ['取消订阅', 'Unsubscribe'],
  subscribed: ['已订阅，后续更新会出现在消息通知中', 'Subscribed. Future updates will appear in notifications.'],
  unsubscribed: ['已取消订阅', 'Unsubscribed'], failed: ['无法更新订阅，请重试', 'Could not update your subscription. Try again.'],
  unavailable: ['订阅适用于团队知识库', 'Subscriptions are available in team knowledge bases'],
  loading: ['读取订阅中…', 'Loading subscription…'], retry: ['重试订阅状态', 'Retry subscription status'],
});

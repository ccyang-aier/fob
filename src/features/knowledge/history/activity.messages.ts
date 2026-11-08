import { defineMessages } from '@/lib/i18n';
export const activityMessages = defineMessages({
  activity: ['页面动态', 'Page activity'], readers: ['浏览记录', 'Views'], edits: ['编辑记录', 'Edits'], versions: ['版本', 'Versions'],
  currentVersion: ['当前版本', 'Current version'], close: ['关闭动态', 'Close activity'],
  unknownReader: ['未知人士', 'Unknown viewer'], unknownEditor: ['未知编辑者', 'Unknown editor'], edited: ['编辑了文档', 'Edited this document'],
  loading: ['正在加载', 'Loading'], failed: ['无法加载页面动态', 'Could not load page activity'], retry: ['重试', 'Retry'],
  noReaders: ['还没有浏览记录', 'No views yet'], noEdits: ['还没有编辑记录', 'No edits yet'],
  justNow: ['刚刚', 'Just now'], minutesAgo: ['{count} 分钟前', '{count} minutes ago'],
  today: ['今天', 'Today'], yesterday: ['昨天', 'Yesterday'],
});

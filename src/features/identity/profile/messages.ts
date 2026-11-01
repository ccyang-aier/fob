import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  documents: ['文档','Documents'], coffee: ['收获咖啡','Coffee received'], likes: ['收获点赞','Likes received'],
  documentsHint: ['当前知识库中你创建且仍可访问的文档','Your accessible documents in this knowledge base'],
  coffeeHint: ['他人赠送给你的咖啡累计数量','Total coffee gifted to you by others'],
  likesHint: ['当前知识库中，你的评论累计收到的他人点赞','All likes from others on your comments in this knowledge base'],
  halfYear: ['近6个月', 'Last 6 months'], activities: ['{count} 次活动', '{count} activities'],
  mon: ['周一', 'Mon'], wed: ['周三', 'Wed'], fri: ['周五', 'Fri'], less: ['少', 'Less'], moreActivity: ['多', 'More'],
  heatmap: ['个人活动日历，使用方向键选择日期', 'Activity calendar. Use arrow keys to select a date.'],
  activityOnDay: ['{date} · {count} 次活动', '{date} · {count} activities'], activityDetails: ['{date}的活动明细', 'Activity details for {date}'],
  activityCreated: ['发布文档', 'Documents created'], activityCommented: ['发表评论', 'Comments posted'], activityLiked: ['点赞评论', 'Comments liked'], activitySubscribed: ['订阅内容', 'Content subscribed'],
  earnedMedals: ['获得的勋章', 'Earned medals'], noMedals: ['尚未获得勋章', 'No medals earned yet'],
  gardener: ['知识园丁', 'Knowledge gardener'], creator: ['持续创作', 'Consistent creator'], sharing: ['乐于分享', 'Happy to share'],
  gardenerHint: ['已创建 {count} 篇文档', '{count} documents created'], creatorHint: ['连续活跃 {count} 天', 'Active for {count} consecutive days'], sharingHint: ['已公开分享 {count} 篇文档', '{count} documents shared publicly'],
  chooseBase: ['选择知识库后可查看活动与勋章', 'Select a knowledge base to see activity and medals'],
  loading: ['正在加载活动…', 'Loading activity…'], loadFailed: ['活动暂时无法加载', 'Could not load activity'], retry: ['重试', 'Try again'],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  me: ['我', 'Me'],
  members: ['成员', 'Member'],
  replyToValue: ['回复 {v0}…', 'Reply to {v0}…'],
  sendReply: ['发送回复', 'Send reply'],
  sending: ['发送中…', 'Sending…'],
  pageComment: ['页面评论', 'Page comment'],
  comments: ['评论', 'Comments'],
  collapseCommentsPanel: ['收起评论栏', 'Collapse comments panel'],
  commentList: ['评论列表', 'Comment list'],
  loadingComments: ['正在加载评论', 'Loading comments'],
  unableToLoadComments: ['评论加载失败', 'Unable to load comments'],
  retry: ['重试', 'Retry'],
  noMatchingComments: ['没有符合条件的评论', 'No matching comments'],
  noCommentsYet: ['还没有评论', 'No comments yet'],
  tryAdjustingYourFilters: ['试试调整筛选条件。', 'Try adjusting your filters.'],
  shareYourThoughtsOrPostAQuestionTo: [
    '分享想法，或将需要跟进的事项作为问题发表。',
    'Share your thoughts or post a question to follow up.',
  ],
  pageDiscussionsAppearHere: ['页面的讨论会显示在这里。', 'Page discussions appear here.'],
  clearFilters: ['清除筛选', 'Clear filters'],
  anchorWithoutAThread: ['无关联线程的锚点', 'Anchor without a thread'],
  orphanedAnchor: ['孤立锚点', 'Orphaned anchor'],
  writeACommentAndShareYourThoughts: [
    '写下评论，分享你的想法…',
    'Write a comment and share your thoughts…',
  ],
  post: ['发表', 'Post'],
  yourPermissionsOnlyAllowViewingComments: [
    '当前权限仅可查看评论',
    'Your permissions only allow viewing comments',
  ],
});

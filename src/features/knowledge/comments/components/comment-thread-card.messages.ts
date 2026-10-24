import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  quotedText: ['引用正文', 'Quoted text'],
  locateThisCommentInTheDocument: ['在正文中定位该评论', 'Locate this comment in the document'],
  originalTextNoLongerExists: ['原文已不存在', 'Original text no longer exists'],
  locateOriginalText: ['定位原文', 'Locate original text'],
  theOriginalTextForThisCommentNoLonger: [
    '该评论的原文已不存在',
    'The original text for this comment no longer exists',
  ],
  commentThreadValue: ['评论线程：{v0}', 'Comment thread: {v0}'],
  pageComment: ['页面评论', 'Page comment'],
  me: ['我', 'Me'],
  members: ['成员', 'Member'],
  deletedComment: ['已删除的评论', 'Deleted comment'],
  resolved: ['已解决', 'Resolved'],
  unresolved: ['待解决', 'Unresolved'],
  reopening: ['重新打开中…', 'Reopening…'],
  updating: ['标记中…', 'Updating…'],
  reopen: ['重新打开', 'Reopen'],
  markAsResolved: ['标记为已解决', 'Mark as resolved'],
  reply: ['回复', 'Reply'],
  reopenQuestion: ['重新打开问题', 'Reopen question'],
  resolveQuestion: ['解决问题', 'Resolve question'],
  working: ['处理中…', 'Working…'],
  resolve: ['解决', 'Resolve'],
  commentAnchorWithoutAThread: ['无关联线程的评论锚点', 'Comment anchor without a thread'],
  thisAnchorHasNoCommentThreadTheOriginal: [
    '此锚点没有对应的评论线程；原文保持不变。',
    'This anchor has no comment thread. The original text is unchanged.',
  ],
  removeAnchor: ['移除锚点', 'Remove anchor'],
});

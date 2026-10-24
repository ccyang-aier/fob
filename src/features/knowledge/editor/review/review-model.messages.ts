import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  readOnlyAcceptingOrRejectingSuggestionsChangesThe: [
    '只读模式：接受或拒绝建议会修改正文，需要此页面的编辑权限。',
    'Read only: accepting or rejecting suggestions changes the content and requires edit permission.',
  ],
  noSuggestionsToReview: ['当前没有待审阅的建议。', 'No suggestions to review.'],
  image: ['图片', 'Image'],
  video: ['视频', 'Video'],
  audio: ['音频', 'Audio'],
  attachment: ['附件', 'Attachment'],
  equation: ['公式', 'Equation'],
  inlineEquation: ['行内公式', 'Inline equation'],
  embed: ['嵌入', 'Embed'],
  blockReference: ['块引用', 'Block reference'],
  pageLink: ['页面链接', 'Page link'],
});

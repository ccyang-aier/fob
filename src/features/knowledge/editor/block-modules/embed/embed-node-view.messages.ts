import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  embed: ['嵌入', 'Embed'],
  cancel: ['取消', 'Cancel'],
  webEmbed: ['网页嵌入', 'Web embed'],
  enterACompleteHttpOrHttpsUrl: [
    '请输入完整的 http:// 或 https:// 地址',
    'Enter a complete http:// or https:// URL',
  ],
  openOriginalPage: ['打开原网页', 'Open original page'],
  editEmbed: ['编辑嵌入', 'Edit embed'],
  embedWebpage: ['嵌入网页', 'Embed webpage'],
  supportsWebpageYoutubeAndVimeoLinks: [
    '支持网页、YouTube 和 Vimeo 链接。',
    'Supports webpage, YouTube and Vimeo links.',
  ],
  embedTitle: ['嵌入标题', 'Embed title'],
  titleOptional: ['标题（可选）', 'Title (optional)'],
  embedUrl: ['嵌入链接', 'Embed URL'],
  ifEmbeddingIsDeniedOpenTheOriginalPage: [
    '若网页拒绝嵌入，可在右上角打开原网页。',
    'If embedding is denied, open the original page from the top right.',
  ],
});

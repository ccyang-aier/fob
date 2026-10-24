import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  invalidImageAddress: ['图片地址无效', 'Invalid image address'],
  imageIsNotAssociatedWithAKnowledgeBase: [
    '图片尚未关联知识库',
    'Image is not associated with a knowledge base',
  ],
  unableToLoadImage: ['图片加载失败', 'Unable to load image'],
  retry: ['重试', 'Retry'],
  loadingImage: ['正在加载图片…', 'Loading image…'],
});

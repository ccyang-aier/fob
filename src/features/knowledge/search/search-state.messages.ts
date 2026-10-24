import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  semanticSearchValue: ['语义腿:{v0}', 'Semantic search: {v0}'],
  currentModel: ['当前模型', 'Current model'],
  semanticSearchUnavailableNoModelConfigured: [
    '语义腿未启用(未配置模型)',
    'Semantic search unavailable (no model configured)',
  ],
  reranked: ['已重排', 'Reranked'],
  notReranked: ['未重排', 'Not reranked'],
});

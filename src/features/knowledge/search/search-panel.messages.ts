import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  searchPagesAndBlocks: ['搜索页面与块(中英文、语义混合)', 'Search pages and blocks'],
  hybridSearch: ['混合检索', 'Hybrid search'],
  searchResults: ['检索结果', 'Search results'],
  keyword: ['关键词', 'Keyword'],
  semantic: ['语义', 'Semantic'],
  reranked: ['重排', 'Reranked'],
  noResultsTryDifferentKeywords: [
    '没有匹配的结果;试试其他关键词。',
    'No results. Try different keywords.',
  ],
  searchUnavailable: ['搜索暂不可用(', 'Search unavailable ('],
  pleaseRetryLater: ['),稍后重试。', '). Please retry later.'],
  enterAtLeastTwoCharactersToSearch: [
    '输入至少两个字符开始搜索。',
    'Enter at least two characters to search.',
  ],
});

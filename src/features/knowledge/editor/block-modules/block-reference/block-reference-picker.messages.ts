import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  cancel: ['取消', 'Cancel'],
  emptyValue: ['空白 {v0}', 'Empty {v0}'],
  referenceDocumentContent: ['引用文档内容', 'Reference document content'],
  chooseReferenceBlock: ['选择引用块', 'Choose reference block'],
  readingPageContent: ['正在读取页面内容…', 'Reading page content…'],
  unableToReadChooseThePageAgain: [
    '读取失败，请重新选择页面。',
    'Unable to read. Choose the page again.',
  ],
  noContentToReferenceOnThisPageYet: [
    '这个页面还没有可引用的内容。',
    'No content to reference on this page yet.',
  ],
  searchSourcePages: ['搜索来源页面', 'Search source pages'],
  searchSourcePages2: ['搜索来源页面…', 'Search source pages…'],
  chooseSourcePage: ['选择来源页面', 'Choose source page'],
  loadingPages: ['正在加载页面…', 'Loading pages…'],
  pageListUnavailable: ['页面列表暂不可用。', 'Page list unavailable.'],
  noMatchingPages: ['没有匹配的页面', 'No matching pages'],
  noOtherPagesAvailableToReference: [
    '还没有其他可引用的页面。',
    'No other pages available to reference.',
  ],
});

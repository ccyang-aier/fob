import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  untitledSection: ['无标题章节', 'Untitled section'],
  unableToGeneratePresentationCloseAndRetry: [
    '演示内容生成失败，请关闭后重试。',
    'Unable to generate presentation. Close and retry.',
  ],
  dismissMessage: ['关闭提示', 'Dismiss message'],
  searchDocument: ['在文档中搜索', 'Search document'],
  searchTermInDocument: ['文档内搜索词', 'Search term in document'],
  noResults: ['无结果', 'No results'],
  caseSensitive: ['区分大小写', 'Case sensitive'],
  previousMatch: ['上一个匹配', 'Previous match'],
  nextMatch: ['下一个匹配', 'Next match'],
  closeDocumentSearch: ['关闭文档搜索', 'Close document search'],
  documentReadingNavigation: ['文档阅读导航', 'Document reading navigation'],
  outline: ['目录', 'Outline'],
  documentBottomActions: ['文档底部操作', 'Document bottom actions'],
  exitFullScreen: ['退出全屏', 'Exit full screen'],
  fullScreen: ['全屏', 'Full screen'],
  fullScreenWasDeniedCheckBrowserPermissions: [
    '浏览器未允许全屏，请检查浏览器权限。',
    'Full screen was denied. Check browser permissions.',
  ],
  documentPresentation: ['文档演示', 'Document presentation'],
  untitledDocument: ['无标题文档', 'Untitled document'],
  exitPresentation: ['退出演示', 'Exit presentation'],
  presentSlideValue: ['演示第 {v0} 页', 'Present slide {v0}'],
  preparingPresentation: ['正在准备演示…', 'Preparing presentation…'],
  previousPage: ['上一页', 'Previous page'],
  nextPage: ['下一页', 'Next page'],
});

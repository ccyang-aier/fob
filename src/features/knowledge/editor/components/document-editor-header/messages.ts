import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  untitledDocument: ['无标题文档', 'Untitled document'],
  openContainingFolderValue: ['打开所属文件夹：{v0}', 'Open containing folder: {v0}'],
  expandKnowledgeBaseSidebarValue: [
    '展开知识库侧栏 · {v0}',
    'Expand knowledge base sidebar · {v0}',
  ],
  pdfThumbnails: ['PDF 缩略图', 'PDF thumbnails'],
  documentOutline: ['文档目录', 'Document outline'],
  collapseThumbnails: ['收起缩略图', 'Collapse thumbnails'],
  expandThumbnails: ['展开缩略图', 'Expand thumbnails'],
  collapseOutline: ['收起目录', 'Collapse outline'],
  expandOutline: ['展开目录', 'Expand outline'],
  me: ['我', 'Me'],
  share: ['分享', 'Share'],
  shareDocument: ['分享文档', 'Share document'],
  copyTitleAndContent: ['复制标题和正文', 'Copy title and content'],
  copiedToClipboard: ['已复制到剪贴板', 'Copied to clipboard'],
  unableToCopyCheckBrowserPermissions: [
    '复制失败，请检查浏览器权限',
    'Unable to copy. Check browser permissions.',
  ],
  newDocument: ['新建文档', 'New document'],
  youCannotCreateDocuments: ['没有创建文档的权限', 'You cannot create documents'],
  new: ['新建', 'New'],
});

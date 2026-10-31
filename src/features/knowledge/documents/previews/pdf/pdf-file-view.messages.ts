import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  thisPdfIsPasswordProtectedDownloadItUnlock: [
    '这份 PDF 有密码保护，请下载原文件解锁后重新上传。',
    'This PDF is password protected. Download it, unlock it and upload again.',
  ],
  unableToReadPdfCheckWhetherTheFile: [
    'PDF 无法读取，请检查原文件是否损坏或受到密码保护。',
    'Unable to read PDF. Check whether the file is damaged or password protected.',
  ],
  pdfThumbnails: ['PDF 缩略图', 'PDF thumbnails'],
  thumbnails: ['缩略图', 'Thumbnails'],
  collapseThumbnails: ['收起缩略图', 'Collapse thumbnails'],
  goToPageValue: ['跳转到第 {v0} 页', 'Go to page {v0}'],
  page: ['第', 'Page'],
  page2: ['页', 'page'],
  continuouslyScrollingPdf: ['连续滚动 PDF', 'Continuously scrolling PDF'],
  readingPdf: ['正在读取 PDF…', 'Reading PDF…'],
  commentOnSelectedPdfText: ['评论所选 PDF 文字', 'Comment on selected PDF text'],
  comments: ['评论', 'Comments'],
});

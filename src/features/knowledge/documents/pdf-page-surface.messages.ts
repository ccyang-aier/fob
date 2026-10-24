import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToRenderThisPageOpenTheFile: [
    '此页无法渲染，请重新打开。',
    'Unable to render this page. Open the file again.',
  ],
  pageValueThumbnail: ['第 {v0} 页缩略图', 'Page {v0} thumbnail'],
  pdfPageValue: ['PDF 第 {v0} 页', 'PDF page {v0}'],
  viewAnnotationOnPageValueValue: [
    '查看第 {v0} 页批注：{v1}',
    'View annotation on page {v0}: {v1}',
  ],
});

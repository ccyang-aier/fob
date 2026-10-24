import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToParseDocumentCheckTheOriginalFile: [
    '文档解析失败，请检查原文件是否完整，或下载后使用 Office 打开。',
    'Unable to parse document. Check the original file or download it to open in Office.',
  ],
  unableToRenderSlidesOpenTheFileAgain: [
    '幻灯片渲染失败，请重新打开。',
    'Unable to render slides. Open the file again.',
  ],
  unableToChangeZoom: ['无法调整显示比例。', 'Unable to change zoom.'],
  layingOutDocument: ['正在排版文档…', 'Laying out document…'],
  powerpointSlidePreview: ['PowerPoint 幻灯片预览', 'PowerPoint slide preview'],
  wordDocumentPreview: ['Word 文档预览', 'Word document preview'],
});

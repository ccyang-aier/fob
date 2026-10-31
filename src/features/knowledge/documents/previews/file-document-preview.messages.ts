import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  textStructurePreviewsSupportFilesUpTo10: [
    '文本结构预览支持 10 MB 以内的文件，请下载原文件查看。',
    'Text structure previews support files up to 10 MB. Download the original to view larger files.',
  ],
  unableToReadOriginalFile: ['原文件读取失败', 'Unable to read original file'],
  conversionServiceIsBusyRetryLater: [
    '转换服务繁忙，请稍后重试。',
    'Conversion service is busy. Retry later.',
  ],
  docConversionSupportsFilesUpTo32Mb: [
    'DOC 转换支持 32 MB 以内的文件。',
    'DOC conversion supports files up to 32 MB.',
  ],
  docConversionFailedCheckTheFileOrDownload: [
    'DOC 转换失败，请确认文档完整，或下载原文件查看。',
    'DOC conversion failed. Check the file or download the original.',
  ],
  invalidPreviewResponse: ['预览响应格式异常。', 'Invalid preview response.'],
  documentConversionFailed: ['文档转换失败', 'Document conversion failed'],
  filePreview: ['文件预览', 'File preview'],
  file: ['文件', 'File'],
  previousPage: ['上一页', 'Previous page'],
  previewPageNumber: ['预览页码', 'Preview page number'],
  nextPage: ['下一页', 'Next page'],
  zoomOut: ['缩小预览', 'Zoom out'],
  resetZoom: ['恢复显示比例', 'Reset zoom'],
  zoomIn: ['放大预览', 'Zoom in'],
  fullScreenPreview: ['全屏预览', 'Full-screen preview'],
  downloadOriginalFile: ['下载原文件', 'Download original file'],
  attachAnOriginalFileToPreview: ['关联原文件后即可预览', 'Attach an original file to preview'],
  thisRecordOnlyContainsDocumentInformationItsOriginal: [
    '当前记录只有文档信息，尚未保存原文件。',
    'This record only contains document information. Its original file has not been saved.',
  ],
  unableToCompletePreview: ['预览未能完成', 'Unable to complete preview'],
  readAgain: ['重新读取', 'Read again'],
  readingAndLayingOut: ['正在读取并排版…', 'Reading and laying out…'],
  wordDocument: ['Word 文档', 'Word document'],
  generatingAPreviewSendsThisDocFileTo: [
    '生成预览会将这份 DOC 发送至 Fob 服务进行临时转换。',
    'Generating a preview sends this DOC file to Fob for temporary conversion.',
  ],
  generateAPaginatedViewPreservingTheOriginalLayout: [
    '生成分页阅读视图，保留原文档的排版。',
    'Generate a paginated view preserving the original layout.',
  ],
  generatePreview: ['生成预览', 'Generate preview'],
  previewUnavailableForThisFormatDownloadTheOriginal: [
    '此格式暂不支持预览，可下载原文件查看。',
    'Preview unavailable for this format. Download the original file.',
  ],
});

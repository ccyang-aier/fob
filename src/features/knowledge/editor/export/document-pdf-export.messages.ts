import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  pdfExportIsTakingTooLongRetryLater: [
    'PDF 导出耗时较长，请稍后重试',
    'PDF export is taking too long. Retry later.',
  ],
  unableToConnectToPdfExportServiceCheck: [
    '无法连接 PDF 导出服务，请检查连接后重试',
    'Unable to connect to PDF export service. Check your connection and retry.',
  ],
  unableToExportPdfRetryLater: ['PDF 导出失败，请稍后重试', 'Unable to export PDF. Retry later.'],
  invalidPdfResponsePleaseRetry: [
    'PDF 文件响应异常，请重试',
    'Invalid PDF response. Please retry.',
  ],
  unableToGeneratePdfPleaseRetry: [
    'PDF 文件生成失败，请重试',
    'Unable to generate PDF. Please retry.',
  ],
  exportServiceIsBusyRetryLater: [
    '导出服务繁忙，请稍后重试',
    'Export service is busy. Retry later.',
  ],
  pdfRenderingServiceUnavailableRetryLater: [
    'PDF 渲染服务暂时不可用，请稍后重试',
    'PDF rendering service unavailable. Retry later.',
  ],
  documentAssetsAreTooLargeToExportAs: [
    '文档资源过大，暂时无法导出 PDF',
    'Document assets are too large to export as PDF',
  ],
});

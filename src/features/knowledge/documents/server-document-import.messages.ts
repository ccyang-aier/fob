import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  textTooLarge: ['文本文件最大支持 1 MB，请拆分后导入。', 'Text files can be up to 1 MB. Split the file before importing.'],
  importingText: ['正在导入正文…', 'Importing document content…'],
  fileSavedAsAnAttachmentDocumentPreviewIs: [
    '文件已保存为附件；此格式暂不支持文档预览。',
    'File saved as an attachment. Document preview is unavailable for this format.',
  ],
  unableToSaveDocumentRecordClickToRetry: [
    '文档记录保存失败，点击重试。',
    'Unable to save document record. Click to retry.',
  ],
  createAFolderBeforeUploadingDocuments: [
    '请先创建一个文件夹，再上传文档。',
    'Create a folder before uploading documents.',
  ],
  added: ['已添加', 'Added'],
  documentsOpenThemFromTheDocumentList: [
    '个文档，可从文档列表打开。',
    'documents. Open them from the document list.',
  ],
  retrySave: ['重试保存', 'Retry save'],
});

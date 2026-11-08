import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  textTooLarge: ['文本文件最大支持 1 MB，请拆分后导入。', 'Text files can be up to 1 MB. Split the file before importing.'],
  chooseASupportedFormatSuchAsPdfPptx: [
    '请选择 PDF、PPTX、Word、CSV、JSON、TXT 或 Markdown 等支持的格式。',
    'Choose a supported format such as PDF, PPTX, Word, CSV, JSON, TXT or Markdown.',
  ],
  eachPreviewFileMustBeNoLargerThan: [
    '单个预览文件请控制在 100 MB 以内。',
    'Each preview file must be no larger than 100 MB.',
  ],
  importedValueDocumentsAndSavedThemLocally: [
    '已导入 {v0} 个文档，已保存至本机。',
    'Imported {v0} documents and saved them locally.',
  ],
  importedOneDocumentAndSavedItLocally: [
    '已导入 {v0} 个文档，已保存至本机。',
    'Imported {v0} document and saved it locally.',
  ],
  unableToSaveCheckBrowserStorageSpace: [
    '保存失败，请检查文件夹权限和磁盘空间。',
    'Unable to save. Check folder permissions and disk space.',
  ],
  unableToReadChooseTheFileAgain: [
    '读取失败，请重新选择文件。',
    'Unable to read. Choose the file again.',
  ],
  dropDocumentsHereOrChoosePdfPptxWord: [
    '拖入文档，或选择 PDF、PPTX、Word、表格与文本文件。',
    'Drop documents here or choose PDF, PPTX, Word, spreadsheet or text files.',
  ],
  contentIsStoredOnlyInThisBrowserUp: [
    '内容保存至所选知识库文件夹，每个文件最大 100 MB。',
    'Content is saved to the chosen knowledge folder. Up to 100 MB per file.',
  ],
  importing: ['正在导入…', 'Importing…'],
  chooseFiles: ['选择文件', 'Choose files'],
  chooseDocumentFiles: ['选择文档文件', 'Choose document files'],
});

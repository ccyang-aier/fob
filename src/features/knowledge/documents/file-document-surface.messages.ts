import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  chooseASupportedPreviewFormat: [
    '请选择支持预览的文档格式。',
    'Choose a supported preview format.',
  ],
  unableToAttachFilePleaseRetry: ['文件关联失败，请重试。', 'Unable to attach file. Please retry.'],
  theOriginalFileUsesThisKnowledgeBaseS: [
    '原文件的访问权限与当前知识库一致。',
    'The original file uses this knowledge base’s access permissions.',
  ],
  chooseOriginalFile: ['选择原文件', 'Choose original file'],
  attachOriginalFile: ['关联原文件', 'Attach original file'],
  closeFileAttachment: ['关闭文件关联', 'Close file attachment'],
  close: ['关闭', 'Close'],
  me: ['我', 'Me'],
  theOriginalFileIsStoredOnlyInThis: [
    '原文件仅保存在当前浏览器。',
    'The original file is stored only in this browser.',
  ],
  unableToSave: ['保存失败', 'Unable to save'],
});

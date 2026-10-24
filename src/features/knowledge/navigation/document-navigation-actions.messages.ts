import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  youCannotCreateDocuments: ['没有创建文档的权限', 'You cannot create documents'],
  document: ['文档', 'Document'],
  unableToCreateDocumentPleaseRetry: [
    '创建文档失败，请重试',
    'Unable to create document. Please retry.',
  ],
  removedFromDrafts: ['已移出草稿', 'Removed from drafts'],
  addedToDrafts: ['已加入草稿', 'Added to drafts'],
  youCannotEditDocuments: ['没有修改文档的权限', 'You cannot edit documents'],
  renameDocument: ['重命名文档', 'Rename document'],
  cancel: ['取消', 'Cancel'],
  save: ['保存', 'Save'],
  documentName: ['文档名称', 'Document name'],
});

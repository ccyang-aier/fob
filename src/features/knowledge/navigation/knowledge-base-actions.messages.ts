import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  folderRenamed: ['文件夹已重命名', 'Folder renamed'],
  folderDeleted: ['文件夹已删除', 'Folder deleted'],
  renameFolder: ['重命名文件夹', 'Rename folder'],
  deleteFolder: ['删除文件夹', 'Delete folder'],
  deleteValueOnlyEmptyFoldersCanBeDeleted: [
    '确定删除「{v0}」？仅空文件夹可以删除；包含文档或回收站内容时，服务会拒绝删除。',
    'Delete “{v0}”? Only empty folders can be deleted, including any trashed content.',
  ],
  deleting: ['删除中…', 'Deleting…'],
  delete: ['删除', 'Delete'],
  cancel: ['取消', 'Cancel'],
  saving: ['保存中…', 'Saving…'],
  save: ['保存', 'Save'],
  folderName: ['文件夹名称', 'Folder name'],
});

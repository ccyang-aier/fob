import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  unsupported: ['当前浏览器不支持直接读写本地文件夹，请使用 Chrome 或 Edge，并通过 HTTPS 或 localhost 访问。', 'This browser cannot read and write local folders. Use Chrome or Edge over HTTPS or localhost.'],
  open: ['打开本地知识库', 'Open local knowledge base'],
  folderHint: ['创建时选择一个空文件夹，文档与附件将自动保存到该文件夹。', 'Choose an empty folder when creating. Documents and attachments will be saved there automatically.'],
  chooseAndCreate: ['选择文件夹并创建', 'Choose folder and create'],
  permission: ['需要重新授权文件夹读写', 'Folder access required'],
  permissionHint: ['授权后即可读取并编辑文件夹中的知识库。', 'Grant read and write access to open this knowledge base.'],
  authorize: ['授权并打开', 'Grant access and open'],
  notEmpty: ['请选择一个空文件夹。已有知识库请使用“打开本地知识库”。', 'Choose an empty folder. Use “Open local knowledge base” for an existing library.'],
  invalid: ['该文件夹不是有效的 Fob 知识库，或文件已损坏。', 'This folder is not a valid Fob knowledge base, or its files are damaged.'],
  conflict: ['文件夹中的知识库已被其他窗口或程序修改。请先保留当前修改，再重新打开文件夹。', 'Another window or app changed this library. Keep a copy of your current changes before reopening the folder.'],
  denied: ['无法读写此文件夹，请检查授权、文件夹是否存在及磁盘空间。', 'Cannot access this folder. Check permissions, its location, and disk space.'],
  saving: ['正在保存到 {folder}…', 'Saving to {folder}…'],
  saved: ['已保存到 {folder}', 'Saved to {folder}'],
  unsaved: ['修改尚未保存到文件夹', 'Changes have not been saved to the folder'],
  retry: ['重试保存', 'Retry saving'],
  recentUnavailable: ['无法记住最近打开的文件夹，下次请手动打开；文件夹内容不受影响。', 'Recent folders could not be remembered. Open the folder manually next time; its contents are safe.'],
  cleanupFailed: ['旧本地知识库清理失败，请关闭其他 Fob 窗口后重试。', 'Could not clear old browser libraries. Close other Fob windows and retry.'],
  deleteLocal: ['删除“{name}”在所选文件夹内的知识库文件、文档、模板和附件。此操作无法撤销。', 'Delete the library files, documents, templates, and attachments for “{name}” from its folder. This cannot be undone.'],
});

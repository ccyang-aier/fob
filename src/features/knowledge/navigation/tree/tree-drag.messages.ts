import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  root: ['移到一级文件夹', 'Move to top level'],
  documentHint: ['拖到目标文件夹', 'Drop on the destination folder'],
  cycle: ['不能移入自身或子文件夹', 'Cannot move into itself or its descendants'],
  missing: ['目标已不存在，请刷新后重试', 'The item is no longer available. Refresh and retry.'],
  unchanged: ['已经在此位置', 'Already at this location'],
  folderRequired: ['请拖到一个文件夹中', 'Drop the document on a folder'],
  moved: ['已移动', 'Moved'],
  failed: ['移动失败，请重试', 'Unable to move. Please retry.'],
  permission: ['移动需要源文档完整权限和目标文件夹编辑权限。', 'Moving requires full access to the source document and edit access to the destination folder.'],
  folderDrag: ['拖动以调整文件夹层级', 'Drag to change the folder hierarchy'],
  documentDrag: ['拖动以移动到文件夹', 'Drag to move to a folder'],
});

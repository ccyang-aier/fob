import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  import: ['导入文档', 'Import documents'],
  move: ['移动文档', 'Move document'],
  destination: ['选择目标文件夹', 'Choose a destination folder'],
  search: ['搜索文件夹…', 'Search folders…'],
  noFolders: ['没有其他可用文件夹', 'No other folders available'],
  noMatches: ['没有匹配的文件夹', 'No matching folders'],
  unfiled: ['未分类', 'Unfiled'],
  importInto: ['导入到「{folder}」', 'Import into “{folder}”'],
  permissions: ['文档及其子文档将继承目标文件夹的权限，显式设置的文档权限会保留。', 'The document and its children inherit destination folder permissions. Explicit document permissions are retained.'],
  loading: ['正在读取文件夹…', 'Loading folders…'],
  unavailable: ['无法读取文档或文件夹，请重试', 'Unable to read the document or folders. Retry.'],
  missing: ['文档或目标文件夹已不可用，请重新选择', 'The document or destination folder is no longer available. Choose again.'],
  failed: ['移动失败，文档保留在原位置，请重试', 'Unable to move. The document remains in its original location. Retry.'],
  moved: ['文档已移动', 'Document moved'],
  retry: ['重试', 'Retry'],
  cancel: ['取消', 'Cancel'],
  close: ['关闭', 'Close'],
  confirmMove: ['移动', 'Move'],
});

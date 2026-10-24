import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  uploadCancelled: ['上传已取消。', 'Upload cancelled.'],
  fileExceedsThe5GibLimit: ['文件超过 5 GiB 上限。', 'File exceeds the 5 GiB limit.'],
  emptyFilesCannotBeUploaded: ['空文件不能上传。', 'Empty files cannot be uploaded.'],
  fileNamesMustContain1255Characters: [
    '文件名长度必须在 1–255 之间。',
    'File names must contain 1–255 characters.',
  ],
});

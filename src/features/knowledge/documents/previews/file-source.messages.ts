import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  previewsSupportFilesUpTo100MbDownload: [
    '预览支持 100 MB 以内的文件，请下载原文件查看。',
    'Previews support files up to 100 MB. Download the original to view larger files.',
  ],
  theOriginalFileIsNotInThisBrowser: [
    '当前浏览器中没有这份原文件，请重新关联。',
    'The original file is not in this browser. Attach it again.',
  ],
  unableToReadOriginalFileCheckAccessPermissions: [
    '无法读取原文件，请检查访问权限后重试。',
    'Unable to read original file. Check access permissions and retry.',
  ],
  theOriginalFileIsEmpty: ['原文件内容为空。', 'The original file is empty.'],
});

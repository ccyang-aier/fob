import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToConnectToObjectStorage: ['无法连接对象存储。', 'Unable to connect to object storage.'],
  objectStorageRejectedTheUploadHttpValue: [
    '对象存储拒绝了上传(HTTP {v0})。',
    'Object storage rejected the upload (HTTP {v0}).',
  ],
  xmlhttprequestIsUnavailableInThisRuntime: [
    '当前运行时没有 XMLHttpRequest,不能装配 XHR 传输。',
    'XMLHttpRequest is unavailable in this runtime.',
  ],
  uploadCancelled: ['上传已取消。', 'Upload cancelled.'],
});

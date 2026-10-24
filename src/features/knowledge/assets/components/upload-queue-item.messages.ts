import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  attachmentValue: ['附件 {v0}', 'Attachment {v0}'],
  cancelUploadOfValue: ['取消上传 {v0}', 'Cancel upload of {v0}'],
  cancel: ['取消', 'Cancel'],
  retryUploadOfValue: ['重试上传 {v0}', 'Retry upload of {v0}'],
  retry: ['重试', 'Retry'],
  removeValue: ['移除 {v0}', 'Remove {v0}'],
  remove: ['移除', 'Remove'],
  reusedIdenticalContentAlreadyExistsInThisKnowledge: [
    '秒传命中 · 知识库已有相同内容',
    'Reused · Identical content already exists in this knowledge base',
  ],
  uploadedAndIntegrityVerified: ['已上传并通过完整性确认', 'Uploaded and integrity verified'],
  cancelledRetryToContinueUploading: [
    '已取消;可重试继续上传。',
    'Cancelled. Retry to continue uploading.',
  ],
  attemptValue: ['· 第 {v0} 次', ' · Attempt {v0}'],
});

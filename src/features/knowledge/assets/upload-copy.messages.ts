import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  calculatingSha256: ['计算 SHA-256', 'Calculating SHA-256'],
  requestingUploadAuthorization: ['获取上传授权', 'Requesting upload authorization'],
  upload: ['上传', 'Upload'],
  verifyingIntegrity: ['确认完整性', 'Verifying integrity'],
  ready: ['已就绪', 'Ready'],
  cancelled: ['已取消', 'Cancelled'],
  failed: ['失败', 'Failed'],
  theServerRemovedTheMismatchedObjectRetryTo: [
    '服务端已删除不匹配的对象,重试将重新上传并确认。',
    'The server removed the mismatched object. Retry to upload and verify again.',
  ],
  uploadAuthorizationMayHaveExpiredRetryToRequest: [
    '预签名授权可能已过期,重试会重新获取。',
    'Upload authorization may have expired. Retry to request it again.',
  ],
  checkYourConnectionAndRetryTheFileFingerprint: [
    '检查网络后重试;已算出的指纹不会重算。',
    'Check your connection and retry. The file fingerprint will be reused.',
  ],
  integrityVerificationFailed: ['完整性确认未通过', 'Integrity verification failed'],
  objectStorageRejectedTheUpload: ['对象存储拒绝了上传', 'Object storage rejected the upload'],
  networkInterruptedBeforeUploadCompleted: [
    '网络中断,直传未完成',
    'Network interrupted before upload completed',
  ],
  unableToAuthorizeUpload: ['获取上传授权失败', 'Unable to authorize upload'],
  unableToReadFile: ['读取文件失败', 'Unable to read file'],
  fileDoesNotMeetUploadRequirements: [
    '文件不符合上传要求',
    'File does not meet upload requirements',
  ],
});

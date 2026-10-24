import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToSendCommentPleaseRetry: [
    '评论发送失败，请重试。',
    'Unable to send comment. Please retry.',
  ],
  writeAComment: ['写下评论…', 'Write a comment…'],
  send: ['发送', 'Send'],
  sending: ['发送中…', 'Sending…'],
  unableToLoadCommentsPleaseRetry: [
    '评论列表加载失败，请重试。',
    'Unable to load comments. Please retry.',
  ],
  unableToLikeCommentPleaseRetry: ['点赞失败，请重试。', 'Unable to like comment. Please retry.'],
  unableToSavePleaseRetry: ['保存失败，请重试。', 'Unable to save. Please retry.'],
  unableToDeleteYourCommentWasKeptPlease: [
    '删除失败，评论已保留，请重试。',
    'Unable to delete. Your comment was kept. Please retry.',
  ],
  unableToConnectToKnowledgeServiceCheckYour: [
    '无法连接知识服务，请检查网络后重试。',
    'Unable to connect to knowledge service. Check your connection and retry.',
  ],
  requestTimedOutPleaseRetry: ['请求超时，请重试。', 'Request timed out. Please retry.'],
  tooManyRequestsRetryLater: ['请求过于频繁，请稍后重试。', 'Too many requests. Retry later.'],
  commentServiceUnavailableRetryLater: [
    '评论服务暂时不可用，请稍后重试。',
    'Comment service unavailable. Retry later.',
  ],
  yourSessionHasExpiredSignInAgainTo: [
    '登录状态已失效，请重新登录后再评论。',
    'Your session has expired. Sign in again to comment.',
  ],
  yourPermissionsDoNotAllowThisCommentAction: [
    '当前权限不能执行该评论操作。',
    'Your permissions do not allow this comment action.',
  ],
  invalidCommentContentOrParameters: [
    '评论内容或参数不符合要求。',
    'Invalid comment content or parameters.',
  ],
  unableToSendReplyPleaseRetry: ['回复发送失败，请重试。', 'Unable to send reply. Please retry.'],
  actionFailedPleaseRetry: ['操作失败，请重试。', 'Action failed. Please retry.'],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  requestTimedOutPleaseRetry: ['请求超时，请重试', 'Request timed out. Please retry.'],
  unableToResolveOrganizationServiceAddress: [
    '组织服务地址无法解析',
    'Unable to resolve organization service address',
  ],
  unableToConnectToOrganizationServiceCheckYour: [
    '无法连接组织服务，请检查网络后重试',
    'Unable to connect to organization service. Check your connection and retry.',
  ],
  organizationServiceUnavailableRetryLater: [
    '组织服务暂不可用，请稍后重试',
    'Organization service unavailable. Retry later.',
  ],
  requestExceedsTheSizeLimit: ['请求内容超出大小限制', 'Request exceeds the size limit'],
  invalidRequestFormat: ['请求格式不正确', 'Invalid request format'],
  requestOriginIsNotTrusted: ['请求来源不受信任', 'Request origin is not trusted'],
  invitationIsNoLongerValid: ['邀请已失效', 'Invitation is no longer valid'],
  thisActionConflictsWithTheCurrentStateRefresh: [
    '操作与当前状态冲突，请刷新后重试',
    'This action conflicts with the current state. Refresh and retry.',
  ],
  aKnowledgeBaseMustHaveAtLeastOne: [
    '知识库必须保留至少一名所有者',
    'A knowledge base must have at least one owner',
  ],
  removeAllPagesBeforeDeletingThisFolder: [
    '团队空间内仍有页面，清空后才能删除',
    'Remove all pages before deleting this folder',
  ],
  folderNotFoundOrHasBeenDeleted: [
    '该团队空间不存在或已删除',
    'Folder not found or has been deleted',
  ],
  groupNotFoundOrHasBeenDeleted: ['该群组不存在或已删除', 'Group not found or has been deleted'],
  memberNotFoundOrHasLeftTheKnowledge: [
    '该成员不存在或已离开知识库',
    'Member not found or has left the knowledge base',
  ],
  yourRoleCannotPerformThisAction: [
    '当前角色没有执行此操作的权限',
    'Your role cannot perform this action',
  ],
  knowledgeBaseNotFoundOrInaccessible: [
    '知识库不存在或不可访问',
    'Knowledge base not found or inaccessible',
  ],
  signInWithAVerifiedSessionToAccess: [
    '需要已验证的登录会话才能访问组织信息',
    'Sign in with a verified session to access organization information',
  ],
  invalidRequestCheckTheParametersAndRetry: [
    '请求参数不正确，请检查后重试',
    'Invalid request. Check the parameters and retry.',
  ],
});

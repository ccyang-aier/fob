import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  signInRequired: ['需要登录', 'Sign-in required'],
  organizationInformationRequiresAVerifiedSessionSignIn: [
    '组织信息需要已验证的登录会话；请在登录知识服务后重试。',
    'Organization information requires a verified session. Sign in and retry.',
  ],
  viewingPermissionDenied: ['没有查看权限', 'Viewing permission denied'],
  guestsCannotBrowseKnowledgeBaseMembersGroupsOr: [
    '访客角色无法浏览知识库的成员、群组与团队空间目录。',
    'Guests cannot browse knowledge base members, groups or folders.',
  ],
  unableToLoad: ['加载失败', 'Unable to load'],
  retry: ['重试', 'Retry'],
  cancel: ['取消', 'Cancel'],
  valueFailedPreviousStateRestoredValue: [
    '{v0}失败，已恢复原状：{v1}',
    '{v0} failed. Previous state restored: {v1}',
  ],
  loading: ['正在加载…', 'Loading…'],
  loadMore: ['加载更多', 'Load more'],
});

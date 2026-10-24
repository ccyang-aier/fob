import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  youCannotGrantMoreAccessThanYouHave: [
    '不能授予超过自己有效级别的权限',
    'You cannot grant more access than you have',
  ],
  invalidOrDuplicatePrincipal: ['主体格式不正确或重复', 'Invalid or duplicate principal'],
  pagePermissionsAndSharing: ['页面权限与分享', 'Page permissions and sharing'],
  pageEditPermissionOrHigherIsRequiredTo: [
    '需要页面 edit 级以上权限才能管理授权。',
    'Page edit permission or higher is required to manage grants.',
  ],
  effectiveAccess: ['有效权限', 'Effective access'],
  allMembers: ['所有成员', 'All members'],
  none: ['无', 'None'],
  inheritParentPermissions: ['继承上级权限', 'Inherit parent permissions'],
  disabledReEnablingRecalculatesDescendantPermissions: [
    '(已断开,恢复将触发子树重算)',
    '(Disabled. Re-enabling recalculates descendant permissions.)',
  ],
  explicitPermissions: ['显式授权', 'Explicit permissions'],
  remove: ['移除', 'Remove'],
  add: ['添加', 'Add'],
  shareLinks: ['分享链接', 'Share links'],
  revoke: ['撤销', 'Revoke'],
  createLink: ['创建链接', 'Create link'],
  newLinkTokenShownOnlyOnce: ['新链接令牌(仅此一次展示):', 'New link token (shown only once):'],
  saving: ['保存中…', 'Saving…'],
  serviceUnavailableRetryLater: ['服务暂不可用,稍后重试', 'Service unavailable. Retry later.'],
  targetIsUnavailableOrDoesNotExist: [
    '目标不可访问或不存在',
    'Target is unavailable or does not exist',
  ],
  youLackThePermissionRequiredForThisAction: [
    '没有操作权限(需要相应级别)',
    'You lack the permission required for this action',
  ],
  untilValue: ['· 至 {v0}', ' · Until {v0}'],
  noExpiry: ['· 永久', ' · No expiry'],
});

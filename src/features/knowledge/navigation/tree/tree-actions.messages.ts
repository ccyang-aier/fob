import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  valueFailedValueValuePreviousPageTreeRestored: [
    '{v0}失败（{v1}）：{v2}已恢复到操作前的页面树。',
    '{v0} failed ({v1}): {v2}Previous page tree restored.',
  ],
  valueFailedConnectionErrorPreviousPageTreeRestored: [
    '{v0}失败：连接异常，已恢复到操作前的页面树。',
    '{v0} failed: connection error. Previous page tree restored.',
  ],
  valueMovedToTrashYouCanRestoreIt: [
    '「{v0}」已移入回收站，可在回收站恢复。',
    '“{v0}” moved to trash. You can restore it from there.',
  ],
  valueRestoredToItsOriginalLocation: [
    '「{v0}」已恢复到原位置。',
    '“{v0}” restored to its original location.',
  ],
  newSubpage: ['新建子页面', 'New subpage'],
  rename: ['重命名', 'Rename'],
  changeIcon: ['更改图标…', 'Change icon…'],
  setCover: ['设置封面…', 'Set cover…'],
  moveUp: ['上移', 'Move up'],
  moveDown: ['下移', 'Move down'],
  indent: ['缩进一级', 'Indent'],
  outdent: ['升缩进一级', 'Outdent'],
  moveToTrash: ['移入回收站', 'Move to trash'],
  yourKnowledgeBaseRoleIsReadOnlyPage: [
    '当前角色对知识库是只读的，页面树操作需要编辑权限。',
    'Your knowledge base role is read only. Page tree actions require edit permission.',
  ],
  newPage: ['新建页面', 'New page'],
  renamePage: ['重命名页面', 'Rename page'],
  changeIcon2: ['更改图标', 'Change icon'],
  setCover2: ['设置封面', 'Set cover'],
  movePage: ['移动页面', 'Move page'],
  restorePage: ['恢复页面', 'Restore page'],
  yourSessionHasExpiredSignInAgainAnd: [
    '登录状态已过期，请重新登录后再试。',
    'Your session has expired. Sign in again and retry.',
  ],
  yourPlanDoesNotSupportThisAction: [
    '当前计划不支持该操作。',
    'Your plan does not support this action.',
  ],
  youDoNotHavePermissionForThisAction: [
    '没有执行该操作的权限。',
    'You do not have permission for this action.',
  ],
  pageNotFoundOrRemovedRefreshTheDirectory: [
    '页面不存在或已被移除，请刷新目录后重试。',
    'Page not found or removed. Refresh the directory and retry.',
  ],
  invalidPageTreeRequest: ['请求内容不符合页面树契约。', 'Invalid page tree request.'],
  pageStructureChangedBySomeoneElseResynchronizing: [
    '页面结构已被他人更新，正在重新同步。',
    'Page structure changed by someone else. Resynchronizing.',
  ],
  requestExceedsTheSizeLimit: ['请求内容超出大小限制。', 'Request exceeds the size limit.'],
  tooManyActionsRetryLater: ['操作过于频繁，请稍后重试。', 'Too many actions. Retry later.'],
  actionTimedOutPleaseRetry: ['操作超时，请重试。', 'Action timed out. Please retry.'],
  knowledgeServiceUnavailable: ['知识服务暂时不可用。', 'Knowledge service unavailable.'],
  unableToConnectToKnowledgeServiceCheckYour: [
    '无法连接知识服务，请检查网络。',
    'Unable to connect to knowledge service. Check your connection.',
  ],
  knowledgeServiceAddressIsNotConfigured: [
    '知识服务地址未配置。',
    'Knowledge service address is not configured.',
  ],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  noAccessInheritanceDisabledAndNoExplicitGrants: [
    '无访问授权(断开继承且无显式授权)',
    'No access (inheritance disabled and no explicit grants)',
  ],
  inheritedFromParentPage: ['继承自上级页面', 'Inherited from parent page'],
  folderDefaultAccess: ['团队空间根默认权限', 'Folder default access'],
  explicitPagePermission: ['本页显式授权', 'Explicit page permission'],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  explicitGrantsOnly: ['仅显式授权', 'Explicit grants only'],
  guest: ['访客', 'Guest'],
  members: ['成员', 'Member'],
  administrator: ['管理员', 'Administrator'],
  owner: ['所有者', 'Owner'],
  knowledgeBaseMembersCanEditMoveAndShare: [
    '知识库成员默认可以编辑、移动与共享页面',
    'Knowledge base members can edit, move and share pages by default',
  ],
  fullControl: ['完全控制', 'Full control'],
  knowledgeBaseMembersCanEditPageContentBy: [
    '知识库成员默认可以编辑页面内容',
    'Knowledge base members can edit page content by default',
  ],
  canEdit: ['可编辑', 'Can edit'],
  knowledgeBaseMembersCanViewAndCommentOn: [
    '知识库成员默认可以查看并评论页面',
    'Knowledge base members can view and comment on pages by default',
  ],
  canComment: ['可评论', 'Can comment'],
  knowledgeBaseMembersCanViewPagesInThis: [
    '知识库成员默认可以查看该团队空间内的页面',
    'Knowledge base members can view pages in this folder by default',
  ],
  canView: ['可查看', 'Can view'],
  rootPagesHaveNoDefaultAccessOnlyExplicitly: [
    '根页面不设默认权限，只有被单独授权的成员与群组可访问',
    'Root pages have no default access. Only explicitly granted members and groups can access them.',
  ],
  changingDefaultAccessImmediatelyInvalidatesExistingPermissionsFor: [
    '修改根默认权限后，该团队空间内所有页面的现有授权会立即失效，系统将按新的默认权限重新计算；重算完成前，依赖旧授权的访问会暂时中断。',
    'Changing default access immediately invalidates existing permissions for every page in this folder. Permissions are recalculated; access relying on old grants is interrupted until that finishes.',
  ],
});

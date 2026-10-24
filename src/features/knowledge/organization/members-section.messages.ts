import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  changedValueSRoleToValue: ['已将 {v0} 的角色改为{v1}', 'Changed {v0}’s role to {v1}'],
  changeRole: ['变更角色', 'Change role'],
  removedValueFromKnowledgeBase: ['已将 {v0} 移出知识库', 'Removed {v0} from knowledge base'],
  removeMember: ['移除成员', 'Remove member'],
  members: ['成员', 'Members'],
  allKnowledgeBaseMembersAppearHereRolesDetermine: [
    '成员目录展示知识库的全部成员；角色决定其管理与浏览权限，变更立即生效。',
    'All knowledge base members appear here. Roles determine management and browsing permissions; changes take effect immediately.',
  ],
  noMembersInThisKnowledgeBase: ['此知识库暂无成员', 'No members in this knowledge base'],
  theKnowledgeBaseOwnerAppearsHereNewMembers: [
    '创建知识库的所有者会出现在这里；新成员加入后会自动列出。',
    'The knowledge base owner appears here. New members are listed automatically.',
  ],
  role: ['角色', 'Role'],
  actions: ['操作', 'Actions'],
  changeValueSRole: ['变更 {v0} 的角色', 'Change {v0}’s role'],
  changeTo: ['变更为', 'Change to'],
  current: ['当前', 'Current'],
  removeValue: ['移除 {v0}', 'Remove {v0}'],
  remove: ['移除', 'Remove'],
  remove2: ['确定将', 'Remove'],
  fromThisKnowledgeBaseAccessWillBeRevoked: [
    '）移出该知识库？ 移除后其将立即失去该知识库的访问权限，所在群组的成员关系也会一并清除。',
    ') from this knowledge base? Access will be revoked immediately and their group memberships will be removed.',
  ],
});

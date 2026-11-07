import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  members: ['成员与权限', 'Members and permissions'],
  ownerOnly: ['仅知识库所有者可管理成员', 'Only the knowledge base owner can manage members'],
  ownerOnlyHint: ['请通过已获授权的文件夹或文档访问知识内容。', 'Access content through folders or documents you have been granted access to.'],
  checkingAccess: ['正在确认知识库权限', 'Checking knowledge base permissions'],
  selectKnowledgeBase: ['请选择知识库', 'Select a knowledge base'],
  selectKnowledgeBaseHint: ['在左上角选择或创建知识库。', 'Choose or create a knowledge base at the top left.'],
  personalKnowledgeBase: ['个人知识库', 'Personal knowledge base'],
  personalOnly: ['本机知识库仅供当前浏览器使用。成员与邀请适用于团队知识库。', 'This local knowledge base is personal to this browser. Members and invitations are available in team knowledge bases.'],
});

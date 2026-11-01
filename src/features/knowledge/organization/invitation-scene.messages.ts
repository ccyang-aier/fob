import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  title: ['加入知识库', 'Join knowledge base'], hint: ['使用受邀邮箱登录后，可阅读知识库内的公开文档。', 'Sign in with the invited email address to read public documents in this knowledge base.'],
  readOnly: ['公开文档默认只读，私有文档需单独授权。', 'Public documents are read-only by default. Private documents require separate access.'],
  accept: ['接受邀请并加入', 'Accept invitation and join'], login: ['使用受邀邮箱登录', 'Sign in with the invited email'], switchAccount: ['切换账号', 'Switch account'],
  openFob: ['打开 Fob', 'Open Fob'], loading: ['正在加载邀请…', 'Loading invitation…'],
  invalid: ['邀请链接已失效或与当前邮箱不匹配，请联系知识库所有者重新邀请。', 'This invitation is unavailable or does not match your email. Ask the knowledge base owner for a new invitation.'],
  joined: ['你已加入该知识库，可以直接打开。', 'You are already a member of this knowledge base.'], open: ['打开知识库', 'Open knowledge base'],
});

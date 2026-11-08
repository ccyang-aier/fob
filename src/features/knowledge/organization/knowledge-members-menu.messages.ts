import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  title: ['知识库成员', 'Knowledge base members'], invite: ['邀请', 'Invite'], email: ['受邀者邮箱', 'Invitee email'],
  inviteLink: ['邀请链接', 'Invitation link'], getLink: ['获取链接', 'Get link'], linkHint: ['填写邮箱，创建专属邀请链接', 'Enter an email to create a personal invite link'], ownerOnly: ['仅知识库管理员可生成邀请', 'Only knowledge base administrators can create invitations'],
  placeholder: ['输入邮箱邀请成员', 'Enter an email to invite'], invalidEmail: ['请输入有效的邮箱地址', 'Enter a valid email address'],
  publicAccess: ['公开文档，默认只读', 'Public documents, read-only by default'], privateAccess: ['私有文档需单独授权', 'Private documents require separate access'],
  ready: ['邀请链接已生成', 'Invitation link is ready'], expires: ['{email} · 7 天内有效', '{email} · Valid for 7 days'],
  copy: ['复制链接', 'Copy link'], copied: ['邀请链接已复制', 'Invitation link copied'], copyFailed: ['复制失败，请重试', 'Could not copy. Try again.'],
  copyEmail: ['复制邮箱', 'Copy email'], emailCopied: ['邮箱已复制', 'Email copied'], memberActions: ['{name}的操作', 'Actions for {name}'],
  joined: ['已加入', 'Joined'], pending: ['邀请中', 'Invited'], you: ['你', 'You'], retry: ['重试', 'Try again'],
  loading: ['正在加载成员…', 'Loading members…'], failed: ['暂时无法加载成员', 'Could not load members'],
  manage: ['管理成员与权限', 'Manage members and access'], revoke: ['撤销', 'Revoke'], revoked: ['邀请已撤销', 'Invitation revoked'],
  reinvite: ['重新邀请', 'Invite again'], reissue: ['重新生成', 'Regenerate'], replacing: ['重新生成后，该邮箱的旧邀请链接将失效。', 'Regenerating replaces the previous invitation link for this email.'],
  pendingFailed: ['暂时无法加载待接受邀请', 'Could not load pending invitations'], empty: ['暂无已加入成员', 'No joined members'],
  expiresOn: ['有效期至 {date}', 'Expires {date}'], duplicate: ['该成员已加入当前知识库', 'This person is already a member'],
  select: ['请先选择知识库', 'Select a knowledge base first'], local: ['本机知识库保存在你选择的文件夹，仅供个人使用，邀请成员需要服务端知识库。', 'Local knowledge bases are personal and stored in your chosen folder. A server knowledge base is required to invite members.'],
  createBase: ['新建知识库', 'Create knowledge base'], login: ['登录后查看成员', 'Sign in to view members'],
});

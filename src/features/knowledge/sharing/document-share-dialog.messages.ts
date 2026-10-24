import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  shareDocument: ['分享文档', 'Share document'],
  membersWithAccessCanOpenThisDocumentUsing: [
    '已有访问权限的成员可以通过链接打开文档。',
    'Members with access can open this document using the link.',
  ],
  close: ['关闭', 'Close'],
  copyLink: ['复制链接', 'Copy link'],
  untitledDocument: ['无标题文档', 'Untitled document'],
  documentShareLink: ['文档分享链接', 'Document share link'],
  linkCopied: ['已复制链接', 'Link copied'],
  unableToCopySelectTheLinkAndCopy: [
    '复制失败，请选择链接后手动复制。',
    'Unable to copy. Select the link and copy it manually.',
  ],
});

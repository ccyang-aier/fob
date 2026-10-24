import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  commentImageUpload: ['评论图片上传', 'Comment image upload'],
  commentsMustContain150000Characters: [
    '评论内容不能为空，且不超过 50000 字符。',
    'Comments must contain 1–50,000 characters.',
  ],
  reply: ['回复', 'Reply'],
  cancel: ['取消', 'Cancel'],
  ctrlEnterToSend: ['Ctrl / ⌘ + Enter 发送', 'Ctrl / ⌘ + Enter to send'],
  mentionMember: ['提及成员', 'Mention member'],
  uploadCommentImage: ['上传评论图片', 'Upload comment image'],
  uploadImage: ['上传图片', 'Upload image'],
  chooseCommentImage: ['选择评论图片', 'Choose comment image'],
  chooseAnImageFile: ['请选择图片文件。', 'Choose an image file.'],
  insertCommentLink: ['插入评论链接', 'Insert comment link'],
  insertLink: ['插入链接', 'Insert link'],
  linkAddress: ['链接地址', 'Link address'],
  commentLinkAddress: ['评论链接地址', 'Comment link address'],
  enterAValidSafeLinkAddress: ['请输入有效、安全的链接地址。', 'Enter a valid, safe link address.'],
  markAsQuestion: ['作为问题', 'Mark as question'],
});

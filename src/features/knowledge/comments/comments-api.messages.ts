import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  invalidResponseFromCommentServiceValue: [
    '评论服务 {v0} 返回的数据不符合契约。',
    'Invalid response from comment service {v0}.',
  ],
  invalidCommentInputForValue: ['{v0} 的输入不符合评论契约。', 'Invalid comment input for {v0}.'],
});

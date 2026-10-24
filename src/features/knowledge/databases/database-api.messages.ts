import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  invalidResponseFromDatabaseServiceValue: [
    '数据库服务 {v0} 返回的数据不符合契约。',
    'Invalid response from database service {v0}.',
  ],
  invalidDatabaseInputForValue: [
    '{v0} 的输入不符合数据库契约。',
    'Invalid database input for {v0}.',
  ],
});

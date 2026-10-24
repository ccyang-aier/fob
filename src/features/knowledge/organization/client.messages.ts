import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  nameIsRequired: ['名称不能为空', 'Name is required'],
  nameMustNotExceed120Characters: [
    '名称不能超过 120 个字符',
    'Name must not exceed 120 characters',
  ],
  valueMustBeAUuid: ['{v0} 必须是 UUID', '{v0} must be a UUID'],
  unknownMemberRole: ['未知成员角色', 'Unknown member role'],
  cursorMustBeAUuid: ['cursor 必须是 UUID', 'cursor must be a UUID'],
  limitMustBeAnIntegerBetween1And: [
    'limit 必须是 1..100 的整数',
    'limit must be an integer between 1 and 100',
  ],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  currentlyUnavailable: ['当前不可用', 'Currently unavailable'],
  locateSuggestionValueValueValue: [
    '定位建议：{v0} · {v1} · {v2}',
    'Locate suggestion: {v0} · {v1} · {v2}',
  ],
  locateThisSuggestionInTheDocument: [
    '在正文中定位这条建议',
    'Locate this suggestion in the document',
  ],
  thisSuggestionAppliesToAWholeBlockImage: [
    '这条建议作用于完整块（图片、公式等非文本内容）',
    'This suggestion applies to a whole block (image, equation or other non-text content)',
  ],
  block: ['块', 'Block'],
  rejectThisSuggestion: ['拒绝这条建议', 'Reject this suggestion'],
  reject: ['拒绝', 'Reject'],
  acceptThisSuggestion: ['接受这条建议', 'Accept this suggestion'],
  accept: ['接受', 'Accept'],
  insert: ['插入', 'Insert'],
  delete: ['删除', 'Delete'],
  replace: ['替换', 'Replace'],
});

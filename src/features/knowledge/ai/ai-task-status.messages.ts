import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  valueBlocks: ['{v0} 块', '{v0} blocks'],
  aiGeneratingValue: ['AI 生成中 · {v0}', 'AI generating · {v0}'],
  contentIsAddedBlockByBlockYouCan: [
    '内容逐块写入页面，可随时取消',
    'Content is added block by block. You can cancel at any time.',
  ],
  aiCompletedValue: ['AI 完成 · {v0}', 'AI completed · {v0}'],
  suggestionsAreInThePageAcceptOrReject: [
    '建议已写入页面，可在审阅中接受或拒绝',
    'Suggestions are in the page. Accept or reject them in review.',
  ],
  cancelledValueAvailableForReview: [
    '已取消 · {v0} 可审阅',
    'Cancelled · {v0} available for review',
  ],
  generatedContentRemainsAsSuggestionsYouCanUndo: [
    '已写入的部分保留为建议，可整体撤销',
    'Generated content remains as suggestions. You can undo the whole task.',
  ],
  failedValue: ['失败 · {v0}', 'Failed · {v0}'],
  valueSuggestionBlocksAddedRetryOrUndoThe: [
    '已写入 {v0} 块建议；可重试或整体撤销',
    '{v0} suggestion blocks added. Retry or undo the whole task.',
  ],
  cancel: ['取消', 'Cancel'],
  undoTask: ['撤销任务', 'Undo task'],
});

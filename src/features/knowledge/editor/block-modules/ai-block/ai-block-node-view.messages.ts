import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  block: ['块', 'Block'],
  aiTaskBlock: ['AI 工作块', 'AI task block'],
  generatedContentAppearsAsSuggestions: [
    '生成内容以建议形式出现',
    'Generated content appears as suggestions',
  ],
  taskInstructions: ['任务说明', 'Task instructions'],
  aiTaskInstructions: ['AI 任务说明', 'AI task instructions'],
  describeWhatYouWantAiToDo: ['描述希望 AI 完成的工作…', 'Describe what you want AI to do…'],
  modelTier: ['模型档位', 'Model tier'],
  aiModelTier: ['AI 模型档位', 'AI model tier'],
  fast: ['快速', 'Fast'],
  deep: ['深度', 'Deep'],
  aiTasksRequireAConnectedTeamKnowledgeBase: [
    'AI 任务需连接团队知识库',
    'AI tasks require a connected team knowledge base',
  ],
  resultEditable: ['结果 · 可继续编辑', 'Result · Editable'],
  unableToStartAiTask: ['AI 任务启动失败', 'Unable to start AI task'],
  unableToCancel: ['取消失败', 'Unable to cancel'],
  unableToUndo: ['撤销失败', 'Unable to undo'],
  generating: ['正在生成 ·', 'Generating ·'],
  stop: ['停止', 'Stop'],
  generated: ['已生成', 'Generated'],
  generationFailedRetryIsAvailable: ['生成失败，可重试', 'Generation failed. Retry is available.'],
  stopped: ['已停止', 'Stopped'],
  regenerate: ['重新生成', 'Regenerate'],
  generate: ['开始生成', 'Generate'],
  undoSuggestionBlocksFromThisTask: [
    '撤销此任务写入的建议块',
    'Undo suggestion blocks from this task',
  ],
  undoGeneration: ['撤销生成', 'Undo generation'],
});

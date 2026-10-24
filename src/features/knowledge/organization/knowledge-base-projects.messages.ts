import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  availableProjects: ['开放项目', 'Available projects'],
  accessHint: ['选择可发现此知识库的项目。成员仍需具备知识库与文档权限。', 'Choose which projects can discover this knowledge base. Knowledge base and document permissions still apply.'],
  save: ['保存', 'Save'],
  cancel: ['取消', 'Cancel'],
  loading: ['正在加载开放项目', 'Loading available projects'],
  loadError: ['无法加载开放项目', 'Unable to load available projects'],
  retry: ['重试', 'Retry'],
  noProjects: ['暂无可选择的项目', 'No projects available'],
  updated: ['开放项目已更新', 'Available projects updated'],
  localSaveError: ['保存失败，请检查本机存储空间。', 'Unable to save. Check local storage space.'],
});

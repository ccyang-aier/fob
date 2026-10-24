import { defineMessages } from '@/lib/i18n';
export const messages = defineMessages({
  tasks: ['任务', 'Tasks'], members: ['成员', 'Members'], assets: ['资产', 'Assets'],
  tasksEmpty: ['还没有任务', 'No tasks yet'], membersEmpty: ['还没有成员记录', 'No member records yet'], assetsEmpty: ['还没有资产', 'No assets yet'],
  tasksDescription: ['项目任务将在这里集中呈现。', 'Your project tasks will appear here.'], membersDescription: ['项目成员将在这里统一管理。', 'Manage your project members here.'], assetsDescription: ['项目中创建的资产将在这里汇集。', 'Your project assets will appear here.'],
  selectProject: ['选择一个项目开始', 'Select a project to begin'], selectDescription: ['在左上角选择或创建项目，进入它的工作台。', 'Choose or create a project at the top left to open its workbench.'],
  loading: ['正在加载项目…', 'Loading projects…'],
});

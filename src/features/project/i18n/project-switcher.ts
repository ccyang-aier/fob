import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  switch: ['切换项目', 'Switch project'], select: ['选择项目', 'Select project'], empty: ['暂无项目', 'No projects'],
  search: ['搜索项目…', 'Search projects…'], noResults: ['没有匹配的项目', 'No matching projects'],
  local: ['本机项目', 'Local project'], server: ['团队项目', 'Team project'],
  create: ['新建项目', 'New project'], rename: ['重命名项目', 'Rename project'], remove: ['删除项目', 'Delete project'],
  name: ['项目名称', 'Project name'], placeholder: ['为项目命名', 'Name your project'], location: ['保存位置', 'Storage'],
  cancel: ['取消', 'Cancel'], save: ['保存', 'Save'], confirm: ['创建项目', 'Create project'], close: ['关闭', 'Close'],
  deleteDescription: ['删除“{name}”后，该项目将无法再访问。此操作无法撤销。', '“{name}” will no longer be accessible. This cannot be undone.'],
  failed: ['操作失败，请重试', 'Could not save. Try again.'], retry: ['重试', 'Retry'], loading: ['正在加载项目…', 'Loading projects…'],
  created: ['项目已创建', 'Project created'], renamed: ['项目名称已更新', 'Project renamed'], removed: ['项目已删除', 'Project deleted'],
  palette: ['图标配色', 'Icon colors'], paletteFailed: ['配色保存失败，请重试', 'Could not save icon colors. Try again.'],
  lagoon: ['青柠湖泊', 'Lime lagoon'], iris: ['鸢尾暮色', 'Iris dusk'], sky: ['蓝色晴空', 'Blue sky'], citrus: ['柑橘薄荷', 'Citrus mint'], meadow: ['晴日草甸', 'Sunlit meadow'], coral: ['珊瑚日落', 'Coral sunset'],
});

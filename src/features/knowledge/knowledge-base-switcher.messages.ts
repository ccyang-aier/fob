import { defineMessages } from '@/lib/i18n';

export const messages = defineMessages({
  switch: ['切换知识库', 'Switch knowledge base'], select: ['选择知识库', 'Select knowledge base'], empty: ['暂无知识库', 'No knowledge bases'],
  search: ['搜索知识库…', 'Search knowledge bases…'], noResults: ['没有匹配的知识库', 'No matching knowledge bases'],
  local: ['本机知识库', 'Local knowledge base'], server: ['团队知识库', 'Team knowledge base'],
  create: ['新建知识库', 'New knowledge base'], rename: ['重命名知识库', 'Rename knowledge base'], remove: ['删除知识库', 'Delete knowledge base'],
  name: ['知识库名称', 'Knowledge base name'], placeholder: ['为知识库命名', 'Name your knowledge base'], location: ['保存位置', 'Storage'],
  cancel: ['取消', 'Cancel'], save: ['保存', 'Save'], confirm: ['创建知识库', 'Create knowledge base'], close: ['关闭', 'Close'],
  deleteDescription: ['删除“{name}”及其文档、文件夹和成员授权。此操作无法撤销。', 'Delete “{name}” and its documents, folders, and member access. This cannot be undone.'],
  failed: ['操作失败，请重试', 'Could not save. Try again.'], retry: ['重试', 'Retry'], loading: ['正在加载知识库…', 'Loading knowledge bases…'],
  created: ['知识库已创建', 'Knowledge base created'], renamed: ['知识库名称已更新', 'Knowledge base renamed'], removed: ['知识库已删除', 'Knowledge base deleted'],
  palette: ['图标配色', 'Icon colors'], paletteFailed: ['配色保存失败，请重试', 'Could not save icon colors. Try again.'],
  selectionSessionOnly: ['知识库选择仅在当前会话生效', 'Knowledge base selection is only kept for this session'],
  localUnavailable: ['无法读取浏览器本机知识库，请检查存储权限与可用空间。', 'Browser knowledge storage is unavailable. Check its permissions and available space.'],
  signInRequired: ['登录后才能创建团队知识库', 'Sign in to create a team knowledge base'],
  invalidName: ['名称需要 1 至 120 个字符', 'Names must contain 1 to 120 characters'],
  lagoon: ['青柠湖泊', 'Lime lagoon'], iris: ['鸢尾暮色', 'Iris dusk'], sky: ['蓝色晴空', 'Blue sky'], citrus: ['柑橘薄荷', 'Citrus mint'], meadow: ['晴日草甸', 'Sunlit meadow'], coral: ['珊瑚日落', 'Coral sunset'],
});

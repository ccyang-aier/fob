import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  knowledgeBaseSidebar: ['知识库侧边栏', 'Knowledge base sidebar'],
  loadingPageTree: ['正在加载页面树', 'Loading page tree'],
  unableToLoadPageTree: ['页面树加载失败', 'Unable to load page tree'],
  unableToReadFoldersRetryLater: [
    '无法读取文件夹目录，请稍后重试。',
    'Unable to read folders. Retry later.',
  ],
  retry: ['重试', 'Retry'],
  unableToBrowsePageTree: ['无法浏览页面树', 'Unable to browse page tree'],
  yourRoleCannotViewThisDirectoryContactThe: [
    '当前角色没有查看该知识库目录的权限，请联系知识库管理员。',
    'Your role cannot view this directory. Contact the knowledge base administrator.',
  ],
});

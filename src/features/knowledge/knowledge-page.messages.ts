import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  selectProjectFirst: ['请先选择项目', 'Select a project first'],
  loadingKnowledgeResources: ['正在加载知识资源', 'Loading knowledge resources'],
  unableToReadLocalDocumentsCheckYourBrowser: [
    '无法读取本机文档，请检查浏览器存储设置。',
    'Unable to read local documents. Check your browser storage settings.',
  ],
  localStorageUnavailable: ['本机存储不可用', 'Local storage unavailable'],
  unableToOpenLocalKnowledgeBase: ['本机知识库无法打开', 'Unable to open local knowledge base'],
  unableToReadBrowserStorage: ['无法读取浏览器存储', 'Unable to read browser storage'],
  document: ['文档', 'Document'],
  unableToCreateDocumentPleaseRetry: [
    '创建文档失败，请重试',
    'Unable to create document. Please retry.',
  ],
  checkingSignInStatus: ['正在确认登录状态', 'Checking sign-in status'],
  unableToVerifySignInStatus: ['无法确认登录状态', 'Unable to verify sign-in status'],
  retry: ['重试', 'Retry'],
  signIn: ['前往登录', 'Sign in'],
  signInToAccessThisKnowledgeBase: ['此知识库需要登录', 'Sign in to access this knowledge base'],
  signInAndContinue: ['登录并继续', 'Sign in and continue'],
  loadingKnowledgeBase: ['正在加载知识库', 'Loading knowledge base'],
  unableToLoadKnowledgeBases: ['知识库列表加载失败', 'Unable to load knowledge bases'],
  unableToAccessThisKnowledgeBase: ['无法访问此知识库', 'Unable to access this knowledge base'],
  thisKnowledgeBaseWasRemovedOrYourAccount: [
    '知识库已被移除，或当前账户没有访问权限。',
    'This knowledge base was removed or your account has no access.',
  ],
  checkingKnowledgeBasePermissions: ['正在确认知识库权限', 'Checking knowledge base permissions'],
  unableToVerifyKnowledgeBasePermissions: [
    '无法确认知识库权限',
    'Unable to verify knowledge base permissions',
  ],
  youDoNotHaveAccessToThisKnowledge: [
    '没有此知识库的访问权限',
    'You do not have access to this knowledge base',
  ],
  unableToAccessThisDocument: ['无法访问此文档', 'Unable to access this document'],
  checkYourKnowledgeBaseAndDocumentPermissions: [
    '请确认知识库与文档的访问权限。',
    'Check your knowledge base and document permissions.',
  ],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToVerifyPageAccessPleaseRetry: [
    '确认页面访问时出现问题，请重试。',
    'Unable to verify page access. Please retry.',
  ],
  containingFolder: ['所属文件夹', 'Containing folder'],
  checkingPageAccess: ['正在确认页面访问', 'Checking page access'],
  unableToVerifyPageAccess: ['无法确认页面访问', 'Unable to verify page access'],
  youDoNotHaveAccessToThisPage: ['没有该页面的访问权限', 'You do not have access to this page'],
  yourCredentialsCannotViewThisPageContactIts: [
    '当前凭证对这个页面没有查看权限；如果最近权限有调整，请联系页面所有者。',
    'Your credentials cannot view this page. Contact its owner if permissions recently changed.',
  ],
  backToKnowledgeBase: ['返回知识库', 'Back to knowledge base'],
  readingDocumentInformation: ['正在读取文档信息', 'Reading document information'],
  unableToReadDocumentInformation: ['无法读取文档信息', 'Unable to read document information'],
  checkYourConnectionAndRetry: ['请检查网络后重试。', 'Check your connection and retry.'],
  me: ['我', 'Me'],
  unableToOpenPageDocument: ['无法打开页面文档', 'Unable to open page document'],
  openingDocument: ['正在打开文档', 'Opening document'],
  knowledgeServiceUnavailableRetryLater: [
    '知识服务暂时不可用，请稍后重试。',
    'Knowledge service unavailable. Retry later.',
  ],
  unableToConnectToKnowledgeServiceCheckYour: [
    '无法连接知识服务，请检查网络后重试。',
    'Unable to connect to knowledge service. Check your connection and retry.',
  ],
  knowledgeServiceConnectionTimedOutPleaseRetry: [
    '连接知识服务超时，请重试。',
    'Knowledge service connection timed out. Please retry.',
  ],
  tooManyRequestsRetryLater: ['请求过于频繁，请稍后重试。', 'Too many requests. Retry later.'],
  knowledgeServiceAddressIsNotConfigured: [
    '知识服务地址未配置，无法建立连接。',
    'Knowledge service address is not configured.',
  ],
  thisActionRequiresAHigherAccessLevel: [
    '该操作需要更高的访问权限。',
    'This action requires a higher access level.',
  ],
});

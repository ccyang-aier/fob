import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  sourcePageSyncTimedOut: ['来源页同步超时', 'Source page sync timed out'],
  sourcePageReadingPermissionDenied: ['无权读取来源页', 'Source page reading permission denied'],
  blockReferenceClickToOpenTheOriginal: [
    '块引用，点击跳转到原文',
    'Block reference. Click to open the original.',
  ],
  syncingSourceContent: ['正在同步来源内容…', 'Syncing source content…'],
  loadingSourceBlock: ['正在加载来源块', 'Loading source block'],
  loadingSourceBlock2: ['正在加载来源块…', 'Loading source block…'],
  goToOriginal: ['跳转到原文', 'Go to original'],
  changeReference: ['更换引用', 'Change reference'],
  sourcePageAccessDenied: ['无权访问来源页', 'Source page access denied'],
  unableToConnectToSourcePage: ['无法连接来源页', 'Unable to connect to source page'],
  sourceBlockDeleted: ['来源块已删除', 'Source block deleted'],
  circularReferenceTheSourceIsThisPage: [
    '循环引用：来源是当前页面',
    'Circular reference: the source is this page',
  ],
  referenceNotConfigured: ['未配置引用', 'Reference not configured'],
});

import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToReadDocumentAssetsCheckAssetAccess: [
    '文档资源读取失败，请检查资源访问权限后重试',
    'Unable to read document assets. Check asset access permissions and retry.',
  ],
  unableToEmbedDocumentAssets: ['文档资源无法内嵌', 'Unable to embed document assets'],
  untitledDocument: ['无标题文档', 'Untitled document'],
  valueOpenOnline: ['{v0}（联网打开）', '{v0} (open online)'],
  externalEmbed: ['外部嵌入', 'External embed'],
  unableToReadDocumentFontStylesAllowAccess: [
    '无法读取文档字体样式，请允许字体资源访问后重试',
    'Unable to read document font styles. Allow access to font resources and retry.',
  ],
});

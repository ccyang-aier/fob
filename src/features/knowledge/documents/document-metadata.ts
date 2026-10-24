import { translate, type Locale } from '@/lib/i18n';
import { documentMetadataMessages } from './document-metadata.messages';

/** Presentation metadata uses codes, independent of the active display language. */
export const documentSourceCodes = [
  'knowledge-base',
  'local-document',
  'local-upload',
  'figma',
  'feishu',
  'wechat-work',
  'dingtalk',
] as const;
export type DocumentSource = (typeof documentSourceCodes)[number];
export const documentIndexStatuses = ['none', 'indexed', 'indexing', 'failed'] as const;
export type DocumentIndexStatus = (typeof documentIndexStatuses)[number];

const sourceKeys = {
  'knowledge-base': 'knowledgeBase',
  'local-document': 'localDocument',
  'local-upload': 'localUpload',
  figma: 'figma',
  feishu: 'feishu',
  'wechat-work': 'wechatWork',
  dingtalk: 'dingtalk',
} as const satisfies Record<DocumentSource, keyof typeof documentMetadataMessages>;

export function readDocumentSource(value: unknown, fallback: DocumentSource): DocumentSource {
  return documentSourceCodes.find((code) => code === value) ?? fallback;
}

export function readDocumentIndexStatus(value: unknown): DocumentIndexStatus {
  return documentIndexStatuses.find((code) => code === value) ?? 'none';
}

export function documentSourceLabel(source: DocumentSource, locale: Locale): string {
  return translate(documentMetadataMessages, sourceKeys[source], undefined, locale);
}

export function documentIndexStatusLabel(status: DocumentIndexStatus, locale: Locale): string {
  return translate(documentMetadataMessages, status, undefined, locale);
}

import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './file-source.messages';

import { readLocalAsset } from '../assets/local-assets';
import { knowledgeAssetsApi } from '../assets/assets-api';
import type { DocumentFile } from './file-format';

const knowledgeT = createTranslator(knowledgeMessages);

const maximum = 100 * 1024 * 1024;
const tooLarge = () => new Error(knowledgeT('previewsSupportFilesUpTo100MbDownload'));
export async function readDocumentFile(
  knowledgeBaseId: string,
  source: 'local' | 'server',
  file: DocumentFile,
  signal: AbortSignal,
): Promise<Blob> {
  if (file.size > maximum) throw tooLarge();
  if (source === 'local') {
    const stored = await readLocalAsset(knowledgeBaseId, file.source);
    if (!stored) throw new Error(knowledgeT('theOriginalFileIsNotInThisBrowser'));
    if (stored.blob.size > maximum) throw tooLarge();
    return stored.blob;
  }
  const grant = await knowledgeAssetsApi.download(knowledgeBaseId, file.source.slice(6), signal);
  const response = await fetch(grant.url, { signal });
  if (!response.ok) throw new Error(knowledgeT('unableToReadOriginalFileCheckAccessPermissions'));
  if (Number(response.headers.get('content-length')) > maximum) {
    await response.body?.cancel();
    throw tooLarge();
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error(knowledgeT('theOriginalFileIsEmpty'));
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw tooLarge();
      }
      chunks.push(value as Uint8Array<ArrayBuffer>);
    }
  } finally {
    reader.releaseLock();
  }
  return new Blob(chunks, { type: file.mime });
}

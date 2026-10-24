import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './file-format.messages';
const knowledgeT = createTranslator(knowledgeMessages);
export type FileFormat =
  'markdown' | 'pdf' | 'pptx' | 'docx' | 'doc' | 'csv' | 'json' | 'text' | 'image';
export type DocumentFile = { source: string; name: string; mime: string; size: number };
const formats: Record<string, FileFormat> = {
  md: 'markdown',
  markdown: 'markdown',
  pdf: 'pdf',
  pptx: 'pptx',
  docx: 'docx',
  doc: 'doc',
  csv: 'csv',
  json: 'json',
  txt: 'text',
  text: 'text',
  log: 'text',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  gif: 'image',
};
export function documentFileFormat(name: string): FileFormat | null {
  return formats[name.split('.').pop()!.toLowerCase()] ?? null;
}
export const documentFileAccept =
  '.md,.markdown,.pdf,.pptx,.doc,.docx,.csv,.json,.txt,.text,.log,.png,.jpg,.jpeg,.webp,.gif';
export function fileFromProperties(properties: Record<string, unknown>): DocumentFile | undefined {
  return typeof properties.fileAsset === 'string' &&
    /^asset:[a-f0-9]{64}$/.test(properties.fileAsset) &&
    typeof properties.fileName === 'string'
    ? {
        source: properties.fileAsset,
        name: properties.fileName,
        mime: typeof properties.fileMime === 'string' ? properties.fileMime : '',
        size: typeof properties.fileSize === 'number' ? properties.fileSize : 0,
      }
    : undefined;
}
export function fileProperties(file: DocumentFile) {
  return { fileAsset: file.source, fileName: file.name, fileMime: file.mime, fileSize: file.size };
}
export async function decodeDocumentText(blob: Blob): Promise<string> {
  const data = new Uint8Array(await blob.arrayBuffer());
  if (data[0] === 0xff && data[1] === 0xfe)
    return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff)
    return new TextDecoder('utf-16be').decode(data.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('gb18030').decode(data);
  }
}
/** RFC 4180 fields, including quoted newlines, escaped quotes and empty trailing cells. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.replace(/^\ufeff/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\r' || char === '\n') {
      if (char === '\r' && source[index + 1] === '\n') index++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (quoted) throw new Error(knowledgeT('csvContainsAnUnclosedQuoteCheckTheOriginal'));
  if (field || row.length || (source && !/[\r\n]$/.test(source))) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

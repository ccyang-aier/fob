import { describe, expect, test } from 'bun:test';
import { documentFileFormat, fileFromProperties, fileProperties, decodeDocumentText, parseCsv } from './file-format';
describe('source file formats', () => {
  test('classifies extensions without treating unknown names as binary documents', () => {
    for (const [name, type] of [['设计.PDF', 'pdf'], ['a.doc', 'doc'], ['a.docx', 'docx'], ['a.pptx', 'pptx'], ['a.csv', 'csv'], ['a.json', 'json'], ['a.TXT', 'text'], ['a.md', 'markdown']]) expect(documentFileFormat(name)).toBe(type);
    expect(documentFileFormat('no extension')).toBeNull();
  });
  test('asset properties round trip and reject malformed asset references', () => {
    const file = { source: 'asset:' + 'a'.repeat(64), name: '报告.pdf', mime: 'application/pdf', size: 512 };
    expect(fileFromProperties(fileProperties(file))).toEqual(file);
    expect(fileFromProperties({ fileAsset: 'https://untrusted/file', fileName: 'a.pdf' })).toBeUndefined();
  });
  test('reads UTF8/BOM, UTF16 LE/BE and Chinese GB18030', async () => {
    expect(await decodeDocumentText(new Blob(['\ufeff中文']))).toBe('中文');
    expect(await decodeDocumentText(new Blob([new Uint8Array([255,254,0x2d,0x4e])]))).toBe('中');
    expect(await decodeDocumentText(new Blob([new Uint8Array([254,255,0x4e,0x2d])]))).toBe('中');
    expect(await decodeDocumentText(new Blob([new Uint8Array([0xd6,0xd0,0xce,0xc4])]))).toBe('中文');
  });
  test('CSV preserves embedded delimiters, quotes, newlines and trailing cells', () => {
    expect(parseCsv('\ufeff名称,备注,尾列\r\n张三,"逗号,引号""与换行\n正文",\r\n')).toEqual([['名称','备注','尾列'], ['张三','逗号,引号"与换行\n正文','']]);
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('a,b,')).toEqual([['a','b','']]);
    expect(() => parseCsv('a,"未闭合')).toThrow('未闭合');
  });
});

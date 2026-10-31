import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { Editor } from '@tiptap/core';

let downloaded: { blob: Blob; title: string; extension: string } | undefined;
mock.module('@/lib/fob-api-endpoint', () => ({ getFobApiOrigin: async () => ({ origin: 'https://api.fob.test' }) }));
mock.module('./document-html-export', () => ({ exportDocumentHtml: async () => '<html>实时文档快照</html>' }));
mock.module('./document-content-actions', () => ({ downloadDocumentBlob: (blob: Blob, title: string, extension: string) => { downloaded = { blob, title, extension }; } }));
const { exportDocumentPdf } = await import('./document-pdf-export');
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; downloaded = undefined; });

describe('PDF export download', () => {
  test('posts the inline snapshot and downloads verified PDF bytes directly', async () => {
    let request: Request | undefined;
    globalThis.fetch = (async (url, options) => {
      request = new Request(url, options);
      return new Response('%PDF-1.7\nactual PDF bytes', { headers: { 'Content-Type': 'application/pdf' } });
    }) as typeof fetch;
    await exportDocumentPdf({} as Editor, '中文标题');
    expect(request!.url).toBe('https://api.fob.test/api/knowledge/export/pdf');
    expect(request!.headers.get('content-type')).toBe('text/html;charset=utf-8');
    expect(await request!.text()).toBe('<html>实时文档快照</html>');
    expect(downloaded?.title).toBe('中文标题');
    expect(downloaded?.extension).toBe('pdf');
    expect(await downloaded?.blob.text()).toContain('%PDF-1.7');
  });
  test('keeps useful renderer and size errors and never downloads a failure response', async () => {
    for (const [code, message] of [['PDF_BUSY', '繁忙'], ['PDF_UNAVAILABLE', '不可用'], ['PAYLOAD_TOO_LARGE', '过大']]) {
      globalThis.fetch = (async () => Response.json({ code }, { status: 503 })) as typeof fetch;
      await expect(exportDocumentPdf({} as Editor, '标题')).rejects.toThrow(message);
      expect(downloaded).toBeUndefined();
    }
  });
  test('rejects a misleading success response instead of saving an invalid PDF', async () => {
    for (const type of ['text/html', 'application/pdf']) {
      globalThis.fetch = (async () => new Response('<html>error</html>', { headers: { 'Content-Type': type } })) as typeof fetch;
      await expect(exportDocumentPdf({} as Editor, '标题')).rejects.toThrow();
      expect(downloaded).toBeUndefined();
    }
  });
  test('turns transport failures into readable feedback', async () => {
    globalThis.fetch = (async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch;
    await expect(exportDocumentPdf({} as Editor, '标题')).rejects.toThrow('无法连接');
    expect(downloaded).toBeUndefined();
  });
});

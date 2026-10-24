import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer';
import { createDocumentPdfRenderer } from './pdf';

const renderer = createDocumentPdfRenderer();
afterAll(() => renderer.close());
describe.skipIf(!existsSync(await puppeteer.executablePath()))('native PDF rendering (run pdf:prepare first)', () => {
  test('creates paged vector/text PDF with Chinese and prevents document scripts', async () => {
    const pdf = await renderer.render('<html><body><script>document.body.textContent="EXECUTED"</script><h1>接口设计 · 中文</h1><p>中文正文 ABC</p><div style="break-before:page"><h2>第二页</h2><p>末尾内容</p></div></body></html>');
    const raw = new TextDecoder().decode(pdf);
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw).toContain('/ToUnicode');
    expect(raw.match(/\/Type \/Page\b/g)?.length).toBe(2);
  }, 60_000);
  test('blocks remote images and navigation instead of reading private server resources', async () => {
    await expect(renderer.render('<html><body><img src="http://127.0.0.1:8711/api/auth/ok"></body></html>')).rejects.toThrow('PDF_RENDER_FAILED');
    await expect(renderer.render('<html><head><meta http-equiv="refresh" content="0;url=http://127.0.0.1:8711/"></head><body>跳转</body></html>')).rejects.toThrow('PDF_RENDER_FAILED');
  }, 60_000);
  test('bounds renderer concurrency rather than queueing arbitrary documents', async () => {
    const first = renderer.render('<html><body>第一份</body></html>');
    const second = renderer.render('<html><body>第二份</body></html>');
    await expect(renderer.render('<html><body>第三份</body></html>')).rejects.toThrow('PDF_BUSY');
    await Promise.all([first, second]);
  }, 60_000);
});

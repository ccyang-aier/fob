import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { presentationSlides } from './presentation-slides';
let browser: Window;
beforeAll(() => { browser = new Window(); Object.assign(globalThis, { DOMParser: browser.DOMParser }); });
afterAll(() => browser.happyDOM.abort());
describe('document presentation grouping', () => {
  test('keeps rendered blocks and styles while splitting at major headings', () => {
    const pages = presentationSlides('<html><head><style>@font-face{font-family:test}</style></head><body><article class="ProseMirror"><p>开场</p><h2>第一章</h2><p>正文</p><h3>小节</h3><img src="data:image/png;base64,a"><h2>第二章</h2><table><tr><td>末行</td></tr></table></article></body></html>', '接口设计');
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain('接口设计'); expect(pages[0]).toContain('开场');
    expect(pages[1]).toContain('第一章'); expect(pages[1]).toContain('小节'); expect(pages[1]).toContain('data:image/png');
    expect(pages[2]).toContain('末行'); expect(pages.every(page => page.includes('@font-face'))).toBe(true);
  });
  test('escapes the document title and provides an empty document slide', () => {
    const pages = presentationSlides('<html><body><article class="ProseMirror"></article></body></html>', '<script>alert(1)</script>');
    expect(pages).toHaveLength(1); expect(pages[0]).toContain('&lt;script&gt;'); expect(pages[0]).not.toContain('<script>');
  });
});

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Editor } from '@tiptap/core';
import { Window } from 'happy-dom';
import { exportDocumentHtml } from './document-html-export';

describe('standalone HTML export', () => {
  let window: Window;
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    window = new Window({ url: 'http://localhost:3000/?view=knowledge' });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    window.happyDOM.abort();
  });
  const editor = () =>
    ({ view: { dom: window.document.querySelector('.ProseMirror') } }) as unknown as Editor;

  test('uses the rendered document presentation, keeps rich content and freezes the editable title', async () => {
    window.document.body.innerHTML = `<section data-knowledge-editor aria-label="页面编辑器" style="background:rgb(251,249,242)"><button>分享</button><article data-width="80" data-font="wenkai" data-size="large" style="width:700px;font-family:Sample;font-size:18px;padding:64px 0 160px"><input data-knowledge-title aria-label="文档标题" value="旧标题" style="font-size:36px;font-weight:700;width:1200px;height:43px"><div class="ProseMirror" contenteditable="true" style="font-size:18px;line-height:1.9"><aside style="background:rgb(240,250,245);border-left:3px solid green"><button data-document-callout-icon aria-label="设置提示框图标与语气"><span>💡</span></button><p>提示正文</p></aside><div data-fob-node="code-block" style="background:#1b2531;border-radius:9px"><button aria-label="代码语言" data-document-export-text>TypeScript</button><button>复制</button><pre style="white-space:pre-wrap"><span style="color:rgb(219,83,73)">const</span> x = 1;</pre></div><span class="katex"><span style="width:22px;height:8px">x²</span></span><table><tr><td colspan="2" style="background:rgb(245,247,250)">表格</td></tr></table><div data-document-export-omit>公式编辑区</div><script>alert(1)</script></div></article></section>`;
    const html = await exportDocumentHtml(editor(), '</h1><script>标题</script>');
    const parsed = new Window().document;
    parsed.write(html);
    const style = (selector: string) =>
      (parsed.querySelector(selector) as unknown as HTMLElement)?.style;
    expect(parsed.querySelector('h1')?.textContent).toBe('</h1><script>标题</script>');
    expect(parsed.querySelector('h1')?.style.fontSize).toBe('36px');
    expect(parsed.querySelector('h1')?.style.width).toBe('auto');
    expect(parsed.querySelector('h1')?.style.height).toBe('auto');
    expect(parsed.querySelector('h1')?.style.maxWidth).toBe('100%');
    expect(parsed.querySelector('h1')?.style.overflowWrap).toBe('anywhere');
    expect(style('.ProseMirror').fontSize).toBe('18px');
    expect(style('aside').backgroundColor).toBe('rgb(240, 250, 245)');
    expect(style('pre span').color).toBe('rgb(219, 83, 73)');
    expect(style('.katex span').width).toBe('22px');
    expect(style('.katex span').height).toBe('8px');
    expect(parsed.querySelector('td')?.getAttribute('colspan')).toBe('2');
    expect(parsed.body.textContent).toContain('💡');
    expect(parsed.body.textContent).toContain('TypeScript');
    expect(parsed.querySelector('button,input,select,script,[contenteditable]')).toBeNull();
    expect(parsed.body.textContent).not.toContain('分享');
    expect(parsed.body.textContent).not.toContain('公式编辑区');
    expect(parsed.querySelector('article')?.style.width).toContain('700px');
    expect(
      parsed.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content'),
    ).toContain("default-src 'none'");
  });

  test('embeds only used font glyph subsets and all media resources once, including attachment downloads', async () => {
    window.document.head.innerHTML = `<style>@font-face{font-family:Sample;src:url('/fonts/latin.woff2');unicode-range:U+0041-005A}@font-face{font-family:Sample;src:url('/fonts/cjk.woff2');unicode-range:U+4E00-9FFF}@font-face{font-family:Unused;src:url('/fonts/unused.woff2')}</style>`;
    window.document.body.innerHTML = `<article data-width="65" data-font="wenkai" data-size="standard" style="font-family:Sample"><div class="ProseMirror"><p>中文</p><img src="/assets/photo.png"><img src="/assets/photo.png"><video controls src="/assets/video.mp4" poster="/assets/photo.png"></video><audio style="display:block" controls src="/assets/audio.mp3"></audio><a href="/assets/report.pdf" download="report.pdf">附件</a></div></article>`;
    const fetched: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      fetched.push(String(url));
      const mime = String(url).endsWith('.woff2')
        ? 'font/woff2'
        : String(url).endsWith('.pdf')
          ? 'application/pdf'
          : String(url).endsWith('.mp4')
            ? 'video/mp4'
            : String(url).endsWith('.mp3')
              ? 'audio/mpeg'
              : 'image/png';
      return {
        ok: true,
        blob: async () => new window.Blob(['resource'], { type: mime }),
      } as unknown as Response;
    }) as typeof fetch;
    const html = await exportDocumentHtml(editor(), '中文');
    expect(html).toContain('data:font/woff2;base64,');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('data:video/mp4;base64,');
    expect(html).toContain('data:audio/mpeg;base64,');
    expect(html).toContain('data:application/pdf;base64,');
    expect(html).not.toContain('localhost');
    expect(html).not.toContain('latin.woff2');
    expect(html).not.toContain('unused.woff2');
    expect(fetched.filter((url) => url.endsWith('photo.png'))).toHaveLength(1);
    expect(fetched).toHaveLength(5);
  });

  test('keeps the selected page background self-contained for HTML and PDF', async () => {
    window.document.body.innerHTML = `<section data-knowledge-editor aria-label="页面编辑器" style="background-color:rgb(250,248,242);background-image:url('/background.png');background-size:cover;background-position:center"><article data-width="80" data-font="default" data-size="standard"><div class="ProseMirror"><p>正文</p></div></article></section>`;
    globalThis.fetch = (async () => ({
      ok: true,
      blob: async () => new window.Blob(['background'], { type: 'image/png' }),
    })) as unknown as typeof fetch;
    const html = await exportDocumentHtml(editor(), '背景');
    expect(html).toContain('background-color:rgb(250, 248, 242)');
    expect(html).toContain('background-image:url("data:image/png;base64,');
    expect(html).toContain('background-size:cover');
    expect(html).not.toContain('background:white');
    expect(html).not.toContain('/background.png');
  });

  test('preserves local SVG references, neutralizes active content and replaces remote frames with a link', async () => {
    window.document.body.innerHTML = `<article data-width="65" data-font="default" data-size="standard"><div class="ProseMirror"><svg><defs><clipPath id="clip"><rect width="10" height="10"></rect></clipPath></defs><path clip-path="url(#clip)" d="M0 0"/><use href="#clip"/></svg><p onclick="alert(1)"><a href="javascript:alert(1)">内容</a></p><iframe src="https://example.com/embedded" title="原网页"></iframe></div></article>`;
    globalThis.fetch = (() => {
      throw new Error('no resource should be fetched');
    }) as typeof fetch;
    const html = await exportDocumentHtml(editor(), '标题');
    expect(html).toContain('id="clip"');
    expect(html).toContain('href="#clip"');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('原网页（联网打开）');
  });

  test('does not silently create an incomplete offline file when a resource cannot be embedded', async () => {
    window.document.body.innerHTML = `<div class="ProseMirror"><img src="/missing.png"></div>`;
    globalThis.fetch = (async () => new Response('', { status: 403 })) as typeof fetch;
    await expect(exportDocumentHtml(editor(), '标题')).rejects.toThrow('资源读取失败');
  });
});

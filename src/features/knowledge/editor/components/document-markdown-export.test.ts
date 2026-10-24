import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import ReactMarkdown from 'react-markdown';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { exportDocumentMarkdown } from './document-markdown-export';

const text = (value: string, marks: readonly Mark[] = []) => schema.text(value, marks);
const node = (type: string, attrs: Record<string, unknown> = {}, content: ProseMirrorNode[] = []) => schema.nodes[type].create(attrs, content);
const paragraph = (value: string) => node('paragraph', { blockId: 'internal_block_id', sourceBlockId: 'internal_source' }, [text(value)]);
const doc = (...content: ProseMirrorNode[]) => node('doc', {}, content);
const exportBody = (...content: ProseMirrorNode[]) => exportDocumentMarkdown(doc(...content), '文档标题');
const parse = (markdown: string) => createMarkdownPipeline().parse(markdown);
const render = (markdown: string) => renderToStaticMarkup(createElement(ReactMarkdown, null, markdown));

describe('public Markdown export', () => {
  it('exports ordinary Markdown rather than private identities, attributes or directives', () => {
    const source = doc(node('heading', { level: 2, blockId: 'heading_id' }, [text('设计概述')]), paragraph('正文 *不是斜体* &copy;'), node('codeBlock', { theme: 'dark', lineNumbers: false, language: 'ts' }, [text('const result = 1;')]));
    const markdown = exportDocumentMarkdown(source, '设计 [一]');
    assert.doesNotMatch(markdown, /fob-|internal_block_id|internal_source|heading_id|lineNumbers|theme=/);
    const restored = parse(markdown);
    assert.equal(restored.child(0).textContent, '设计 [一]');
    assert.equal(restored.child(1).textContent, '设计概述');
    assert.equal(restored.child(2).textContent, '正文 *不是斜体* &copy;');
    assert.equal(restored.child(3).type.name, 'codeBlock');
    assert.equal(restored.child(3).textContent, 'const result = 1;');
  });

  it('preserves adjacent mark runs and handles punctuation at nested formatting boundaries', () => {
    const bold = schema.marks.bold.create();
    const code = schema.marks.code.create();
    const source = node('paragraph', {}, [text('粗', [bold]), text('体', [bold]), text(' 代码 ', [bold, code]), text('和普通文字')]);
    const markdown = exportBody(source);
    assert.match(markdown, /<strong>粗体`  代码  `<\/strong>和普通文字/);
    const ordinary = exportBody(node('paragraph', {}, [text('前文 '), text('粗', [bold]), text('体', [bold]), text(' 后文')]));
    assert.match(render(ordinary), /前文 <strong>粗体<\/strong> 后文/);
    assert.equal(parse(ordinary).child(1).textContent, '前文 粗体 后文');
  });

  it('uses readable inline HTML for underline and highlight and omits comment identities', () => {
    const source = node('paragraph', {}, [text('下划线', [schema.marks.underline.create(), schema.marks.comment.create({ threadId: 'secret_thread' })]), text('强调', [schema.marks.highlight.create({ color: '#ffc000' })])]);
    const markdown = exportBody(source);
    assert.match(markdown, /<u>下划线<\/u>/);
    assert.match(markdown, /<mark>强调<\/mark>/);
    assert.doesNotMatch(markdown, /secret_thread|comment|highlight\{/);
  });

  it('retains ordered task states, nested lists and multi-paragraph items', () => {
    const source = node('taskList', { ordered: true, start: 9 }, [
      node('taskItem', { checked: true }, [paragraph('完成'), node('bulletList', {}, [node('listItem', {}, [paragraph('子项')])]), paragraph('补充说明')]),
      node('taskItem', { checked: false }, [paragraph('待办')]),
    ]);
    const markdown = exportBody(source);
    assert.match(markdown, /9\. \[x\] 完成/);
    assert.match(markdown, /10\. \[ \] 待办/);
    const restored = parse(markdown).child(1);
    assert.equal(restored.type.name, 'taskList');
    assert.equal(restored.attrs.start, 9);
    assert.equal(restored.child(0).attrs.checked, true);
    assert.equal(restored.child(0).child(1).child(0).textContent, '子项');
    assert.equal(restored.child(0).child(2).textContent, '补充说明');
    assert.equal(restored.child(1).attrs.checked, false);
  });

  it('chooses fences that do not swallow embedded backticks or alter whitespace', () => {
    const value = 'before\n```\nconst a = 2;\n````\n  after\n';
    const markdown = exportBody(node('codeBlock', { language: 'markdown' }, [text(value)]), node('paragraph', {}, [text('`value`', [schema.marks.code.create()])]));
    assert.match(markdown, /`````markdown/);
    const restored = parse(markdown);
    assert.equal(restored.child(1).textContent, value);
    assert.equal(restored.child(2).textContent, '`value`');
  });

  it('keeps code language metadata on one safe fence line', () => {
    const markdown = exportBody(node('codeBlock', { language: 'ts\n```\n<script>' }, [text('const x = 1;')]));
    assert.match(markdown, /```ts\nconst x = 1;\n```/);
    assert.doesNotMatch(markdown, /script/);
    const restored = parse(markdown).child(1);
    assert.equal(restored.attrs.language, 'ts');
    assert.equal(restored.textContent, 'const x = 1;');
  });

  it('exports GFM tables with alignment and escaped pipes, including inline code', () => {
    const cell = (type: string, content: ProseMirrorNode, align?: string) => node(type, { align: align ?? null }, [content]);
    const source = node('table', {}, [
      node('tableRow', {}, [cell('tableHeader', paragraph('字段'), 'left'), cell('tableHeader', paragraph('值'), 'right')]),
      node('tableRow', {}, [cell('tableCell', paragraph('A | B')), cell('tableCell', node('paragraph', {}, [text('a|b', [schema.marks.code.create()])]))]),
    ]);
    const markdown = exportBody(source);
    assert.match(markdown, /\| :--- \| ---: \|/);
    const restored = parse(markdown).child(1);
    assert.equal(restored.type.name, 'table');
    assert.equal(restored.child(1).child(0).textContent, 'A | B');
    assert.equal(restored.child(1).child(1).textContent, 'a|b');
    assert.equal(restored.child(0).child(1).attrs.align, 'right');
  });

  it('retains merged cells and rich nested cell content as ordinary HTML', () => {
    const source = node('table', {}, [node('tableRow', {}, [node('tableCell', { colspan: 2, rowspan: 2 }, [paragraph('<script>'), node('bulletList', {}, [node('listItem', {}, [paragraph('列表正文')])]), node('image', { src: 'https://example.com/image.png', alt: '示意图', caption: '说明' })])])]);
    const markdown = exportBody(source);
    assert.match(markdown, /<table><tbody><tr><td colspan="2" rowspan="2">/);
    assert.match(markdown, /<p>&lt;script&gt;<\/p>/);
    assert.match(markdown, /<ul><li><p>列表正文<\/p><\/li><\/ul>/);
    assert.match(markdown, /<img src="https:\/\/example.com\/image.png" alt="示意图">/);
    assert.match(markdown, /<figcaption>说明<\/figcaption>/);
    assert.doesNotMatch(markdown, /data-fob|data-block-id|fob-block/);
  });

  it('preserves callouts, columns, math, media and attachments without application syntax', () => {
    const source = doc(
      node('callout', { emoji: '⚠️', tone: 'warning' }, [paragraph('注意事项')]),
      node('columns', {}, [node('column', { width: 2 }, [paragraph('左栏')]), node('column', {}, [paragraph('右栏')])]),
      node('paragraph', {}, [text('公式 '), node('inlineMath', { latex: 'x^2' })]), node('math', { latex: '\\sum_{i=1}^n i' }),
      node('image', { src: 'https://example.com/a.png', alt: '图例', caption: '图片说明' }),
      node('video', { src: 'https://example.com/video.mp4', title: '演示视频', caption: '视频说明' }),
      node('file', { src: './需求 文档.pdf', title: '需求文档' }), node('embed', { url: 'https://example.com/app', title: '原型' }),
    );
    const markdown = exportDocumentMarkdown(source, '导出');
    assert.match(markdown, /> ⚠️\n>\n> 注意事项/);
    assert.match(markdown, /左栏\n\n右栏/);
    assert.match(markdown, /\$x\^2\$/);
    assert.match(markdown, /\$\$\n\\sum_\{i=1\}\^n i\n\$\$/);
    assert.match(markdown, /!\[图例\]\(<https:\/\/example.com\/a.png>\)/);
    assert.match(markdown, /\[演示视频\]\(<https:\/\/example.com\/video.mp4>\)/);
    assert.match(markdown, /\[需求文档\]\(<\.\/需求%20文档.pdf>\)/);
    assert.ok(markdown.includes('图片说明') && markdown.includes('视频说明'));
    assert.doesNotMatch(markdown, /:::+|fob-|data-fob|column\{/);
  });

  it('escapes literal Markdown syntax and neutralizes unsafe links', () => {
    const source = doc(paragraph('1. 不是列表'), paragraph('- 不是列表'), paragraph('# 不是标题'), node('paragraph', {}, [text('危险链接', [schema.marks.link.create({ href: 'javascript:alert(1)' })]), node('hardBreak'), text('下一行')]));
    const markdown = exportDocumentMarkdown(source, '<标题>');
    const rendered = render(markdown);
    assert.match(rendered, /<h1>&lt;标题&gt;<\/h1>/);
    assert.match(rendered, /<p>1\. 不是列表<\/p>/);
    assert.match(rendered, /<p>- 不是列表<\/p>/);
    assert.match(rendered, /<p># 不是标题<\/p>/);
    assert.match(rendered, /危险链接<br\/>\n下一行/);
    assert.doesNotMatch(markdown, /javascript:|fob-/);
  });

  it('describes private media without exporting unusable knowledgeBase or blob URLs', () => {
    const image = node('image', { src: `asset:${'a'.repeat(64)}`, alt: '部署架构图', caption: '服务之间的连接关系' });
    const file = node('file', { src: `asset:${'b'.repeat(64)}`, title: '需求文档.pdf', caption: '评审附件' });
    const video = node('video', { src: 'blob:http://localhost:3000/local-session', title: '操作演示', caption: '本机录制' });
    const table = node('table', {}, [node('tableRow', {}, [node('tableCell', { colspan: 2 }, [image, file, video])])]);
    for (const markdown of [exportBody(image, file, video), exportBody(table)]) {
      assert.doesNotMatch(markdown, /asset:|blob:|local-session|data:[^ ]*base64/);
      for (const value of ['部署架构图', '服务之间的连接关系', '需求文档.pdf', '评审附件', '操作演示', '本机录制']) assert.ok(markdown.includes(value), value);
    }
  });
});

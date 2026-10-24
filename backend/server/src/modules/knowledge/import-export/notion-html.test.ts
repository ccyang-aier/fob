import { describe, expect, test } from 'bun:test';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { parseNotionHtml } from './notion-html';
import type { NotionParsedPage } from './notion-types';

/** M04:Notion HTML 导出样本(结构仿真实导出:page-body/嵌套/checkbox/表格/附件)。 */
const pipeline = createMarkdownPipeline();

const wrap = (body: string): string => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Test</title></head>
<body><article class="page sans"><header><h1 class="page-title">样本页面</h1></header>
<div class="page-body">${body}</div></article></body></html>`;

const parse = (body: string, links: string[] = []): NotionParsedPage =>
  parseNotionHtml(wrap(body), 'Sample <hash>.html', { linkTargetExists: (href) => links.includes(href) });

const document = (page: NotionParsedPage) => pipeline.fromMdast(page.mdast as Parameters<typeof pipeline.fromMdast>[0]);

const blockTypes = (page: NotionParsedPage): string[] => {
  const types: string[] = [];
  document(page).forEach((child) => types.push(child.type.name));
  return types;
};

describe('notion html headings, inline marks and page title', () => {
  test('converts headings, bold/italic/underline/code/strike and external links', () => {
    const page = parse(`
<h2 class="">季度目标</h2>
<p id="a1">完成 <strong>AI 助手</strong> 上线,重点是 <em class="underline">协同编辑</em> 与 <code>doc_state</code> 与 <s>旧方案</s>。</p>
<p>参考 <a href="https://example.com/spec">外部规格</a> 与 <a class="user" href="mailto:a@b.c">邮件</a>。</p>`);
    expect(page.pageTitle).toBe('样本页面');
    expect(blockTypes(page)).toEqual(['heading', 'paragraph', 'paragraph']);
    const doc = document(page);
    const heading = doc.firstChild!;
    expect(heading.attrs.level).toBe(2);
    expect(heading.textContent).toBe('季度目标');
    const paragraph = doc.child(1)!;
    const marks = paragraph.content.content.flatMap((node) => node.marks.map((mark) => mark.type.name));
    expect(new Set(marks)).toEqual(new Set(['bold', 'underline', 'code', 'strike']));
    const link = doc.child(2)!.content.content.find((node) => node.marks.some((mark) => mark.type.name === 'link'))!;
    expect(link.marks.find((mark) => mark.type.name === 'link')!.attrs.href).toBe('https://example.com/spec');
    expect(page.warnings).toEqual([]);
  });

  test('background colors map to highlight; plain colors keep text and warn', () => {
    const page = parse(`<p>背景 <span class="block-color-yellow_background">高亮</span> 与 <span class="block-color-red">红字</span>。</p>`);
    const paragraph = document(page).firstChild!;
    const highlight = paragraph.content.content.find((node) => node.marks.some((mark) => mark.type.name === 'highlight'));
    expect(highlight!.textContent).toBe('高亮');
    expect(highlight!.marks[0]!.attrs.color).toBe('yellow');
    expect(page.warnings.map((warning) => warning.code)).toEqual(['colored_text']);
  });
});

describe('notion html lists, toggles and quotes', () => {
  test('bullet, ordered and to-do lists keep checkbox state and nesting', () => {
    const page = parse(`
<ul class="bulleted-list"><li>第一点</li><li>第二点<ul class="bulleted-list"><li>嵌套点</li></ul></li></ul>
<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div><span class="to-do-children-checked">已完成</span></li>
<li><div class="checkbox checkbox-off"></div><span class="to-do-children-unchecked">未完成</span></li></ul>
<ol class="numbered-list" start="3"><li>第三项</li></ol>`);
    const doc = document(page);
    const [bullet, task, ordered] = [doc.child(0)!, doc.child(1)!, doc.child(2)!];
    expect(bullet.type.name).toBe('bulletList');
    expect(bullet.child(1).child(1).type.name).toBe('bulletList');
    expect(task.type.name).toBe('taskList');
    expect([task.child(0).attrs.checked, task.child(1).attrs.checked]).toEqual([true, false]);
    expect(task.child(0).textContent).toBe('已完成');
    expect(ordered.type.name).toBe('orderedList');
    expect(ordered.attrs.start).toBe(3);
  });

  test('toggles collapse to sequential blocks with an explicit warning', () => {
    const page = parse(`<ul class="toggle"><li><details open=""><summary>展开我</summary><p>折叠的内容</p></details></li></ul>`);
    expect(blockTypes(page)).toEqual(['paragraph', 'paragraph']);
    expect(document(page).child(0).textContent).toBe('展开我');
    expect(document(page).child(1).textContent).toBe('折叠的内容');
    expect(page.warnings.map((warning) => warning.code)).toEqual(['toggle_collapsed']);
  });

  test('quotes and callouts map to blockquote and callout with emoji', () => {
    const page = parse(`
<figure class="quote"><blockquote>被引用的句子</blockquote></figure>
<figure class="callout"><div class="callout-emoji">🔥</div><div class="callout-border"><p>注意发布顺序</p></div></figure>`);
    const doc = document(page);
    expect(doc.child(0).type.name).toBe('blockquote');
    const callout = doc.child(1)!;
    expect(callout.type.name).toBe('callout');
    expect(callout.attrs.emoji).toBe('🔥');
    expect(callout.textContent).toBe('注意发布顺序');
  });
});

describe('notion html code, math, hr and media', () => {
  test('code figures keep language and content', () => {
    const page = parse(`<figure class="code"><figcaption class="lang-name">python</figcaption><pre><code class="language-python">print("hi")\nassert 1</code></pre></figure>`);
    const code = document(page).firstChild!;
    expect(code.type.name).toBe('codeBlock');
    expect(code.attrs.language).toBe('python');
    expect(code.textContent).toBe('print("hi")\nassert 1');
  });

  test('equations recover LaTeX from KaTeX annotations (block and inline)', () => {
    const page = parse(`
<figure class="equation"><div class="katex-display"><span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E=mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">E</span><span class="base">=</span></span></span></div></figure>
<p>其中 <span class="katex"><span class="katex-mathml"><math><semantics><annotation encoding="application/x-tex">\\alpha</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base">α</span></span></span> 是系数。</p>`);
    const doc = document(page);
    expect(doc.child(0).type.name).toBe('math');
    expect(doc.child(0).attrs.latex).toBe('E=mc^2');
    const inline = doc.child(1).content.content.find((node) => node.type.name === 'inlineMath')!;
    expect(inline.attrs.latex).toBe('\\alpha');
    expect(doc.child(1).textContent).not.toContain('α');
  });

  test('image and file figures become media blocks with caption, hrefs preserved as-is', () => {
    const page = parse(`
<figure class="image"><a href="Sample%20%3Chash%3E/shot.png"><img style="width: 524px" src="Sample%20%3Chash%3E/shot.png"></a><figcaption>架构图</figcaption></figure>
<figure class="file"><a href="Sample%20%3Chash%3E/report.pdf">report.pdf</a><figcaption>月报</figcaption></figure>
<figure class="bookmark"><a class="bookmark-source" href="https://example.com/doc"><div class="bookmark-info"><div class="bookmark-title">文档</div><div class="bookmark-description">说明</div></div></a></figure>`);
    const doc = document(page);
    const image = doc.child(0)!;
    expect(image.type.name).toBe('image');
    expect(image.attrs.src).toBe('Sample%20%3Chash%3E/shot.png');
    expect(image.attrs.caption).toBe('架构图');
    const file = doc.child(1)!;
    expect(file.type.name).toBe('file');
    expect(file.attrs.title).toBe('report.pdf');
    expect(file.attrs.caption).toBe('月报');
    const bookmark = doc.child(2)!;
    expect(bookmark.type.name).toBe('embed');
    expect(bookmark.attrs.url).toBe('https://example.com/doc');
    expect(bookmark.attrs.title).toBe('文档');
  });

  test('unmappable figures keep their text and produce warnings', () => {
    const page = parse(`<figure class="pdf-icon"><div class="icon">PDF</div></figure><hr>`);
    expect(blockTypes(page)).toEqual(['paragraph', 'horizontalRule']);
    expect(document(page).child(0).textContent).toBe('PDF');
    expect(page.warnings.map((warning) => warning.code)).toEqual(['unsupported_element']);
  });
});

describe('notion html database view detection', () => {
  const rowLinks = ['Row%20One%20abc.html', 'Row%20Two%20def.html'];

  test('a page whose body is a single linked table becomes a typed database', () => {
    const page = parse(`
<figure class="table"><table class="simple-table">
<tr class="row"><th class="cell">Name</th><th class="cell">Status</th><th class="cell">Estimate</th><th class="cell">Done</th><th class="cell">Due</th><th class="cell">Link</th><th class="cell">Tags</th></tr>
<tr class="row"><td class="cell"><a href="Row%20One%20abc.html">登录页</a></td><td class="cell">In Progress</td><td class="cell">3</td><td class="cell">Yes</td><td class="cell">2026-03-01</td><td class="cell">https://acme.test/1</td><td class="cell">前端, 登录</td></tr>
<tr class="row"><td class="cell"><a href="Row%20Two%20def.html">支付页</a></td><td class="cell">Done</td><td class="cell">8</td><td class="cell">No</td><td class="cell">2026-04-15</td><td class="cell">https://acme.test/2</td><td class="cell">支付</td></tr>
</table></figure>`, rowLinks);
    expect(page.database).not.toBeNull();
    const types = page.database!.columns.map((column) => column.type);
    expect(types).toEqual(['select', 'number', 'checkbox', 'date', 'url', 'multiSelect']);
    expect(page.database!.rows).toHaveLength(2);
    const [first, second] = page.database!.rows;
    expect(first!.title).toBe('登录页');
    expect(first!.pageKey).toBe('Row%20One%20abc.html');
    const properties = Object.values(first!.properties);
    expect(properties[0]).toBe('In Progress');
    expect(properties[1]).toBe(3);
    expect(properties[2]).toBe(true);
    expect(properties[3]).toBe('2026-03-01');
    expect(properties[5]).toEqual(['前端', '登录']);
    expect(second!.properties[Object.keys(second!.properties)[5]!]).toEqual(['支付']);
    expect(page.mdast.children).toEqual([]);
  });

  test('a table page without resolvable row links stays an inline table block', () => {
    const page = parse(`<figure class="table"><table class="simple-table">
<tr class="row"><th class="cell">列一</th><th class="cell">列二</th></tr>
<tr class="row"><td class="cell"><a href="Missing%20page.html">行</a></td><td class="cell">值</td></tr>
</table></figure>`, rowLinks);
    expect(page.database).toBeNull();
    const table = document(page).firstChild!;
    expect(table.type.name).toBe('table');
    // schema 约定单元格内容为 block+(段落包裹行内内容),链接 mark 落在段内文本上。
    const linked = table.child(1).child(0).content.content[0]!.content.content[0]!;
    expect(linked.marks.some((mark) => mark.type.name === 'link')).toBe(true);
    expect(linked.marks.find((mark) => mark.type.name === 'link')!.attrs.href).toBe('Missing%20page.html');
  });

  test('a database table with surrounding content is not treated as the page itself', () => {
    const page = parse(`<p>说明文字</p><figure class="table"><table class="simple-table">
<tr class="row"><th class="cell">Name</th><th class="cell">Status</th></tr>
<tr class="row"><td class="cell"><a href="Row%20One%20abc.html">行</a></td><td class="cell">Done</td></tr>
</table></figure>`, rowLinks);
    expect(page.database).toBeNull();
    expect(blockTypes(page)).toEqual(['paragraph', 'table']);
  });
});

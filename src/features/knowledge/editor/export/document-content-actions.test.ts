import { describe, expect, test } from 'bun:test';
import type { Editor } from '@tiptap/core';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { Window } from 'happy-dom';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import { documentContent } from './document-content-actions';
import { documentLink, readDocumentLink } from '../document-link';

describe('document content operations', () => {
  test('Markdown keeps headings, inline marks, tasks and table content and escapes the document title', async () => {
    const p = (text: string) => schema.nodes.paragraph.create(null, schema.text(text));
    const body = schema.nodes.doc.create(null, [
      schema.nodes.paragraph.create(null, schema.text('加粗文本', [schema.marks.bold.create()])),
      schema.nodes.taskList.create(
        null,
        schema.nodes.taskItem.create({ checked: true }, p('已完成')),
      ),
      schema.nodes.table.create(null, [
        schema.nodes.tableRow.create(null, [
          schema.nodes.tableHeader.create(null, p('表头')),
          schema.nodes.tableHeader.create(null, p('标题')),
        ]),
        schema.nodes.tableRow.create(null, [
          schema.nodes.tableCell.create(null, p('内容')),
          schema.nodes.tableCell.create(null, p('A | B')),
        ]),
      ]),
    ]);
    const editor = { schema, state: { doc: body } } as Editor;
    const markdown = await documentContent(
      editor,
      '# 标题 [链接](javascript:alert(1))',
      'markdown',
    );
    const parsed = new Window().document;
    parsed.write(renderToStaticMarkup(createElement(ReactMarkdown, null, markdown)));
    expect(parsed.querySelector('h1')?.textContent).toBe('# 标题 [链接](javascript:alert(1))');
    expect(parsed.querySelector('h1 a')).toBeNull();
    expect(parsed.querySelector('strong')?.textContent).toBe('加粗文本');
    expect(markdown).toContain('- [x] 已完成');
    expect(markdown).toContain('| 内容 | A \\| B |');
    expect(markdown).not.toMatch(/fob-block|blockId|:::/);
    expect(editor.state.doc).toBe(body);
  });
  test('HTML escapes title and includes a complete UTF-8 document without changing the body', async () => {
    const window = new Window();
    window.document.body.innerHTML =
      '<article data-width="65" data-font="default" data-size="standard"><input data-knowledge-title aria-label="文档标题"><div class="ProseMirror"><p>正文</p></div></article>';
    const editor = {
      view: { dom: window.document.querySelector('.ProseMirror') },
    } as unknown as Editor;
    const html = await documentContent(editor, '</h1><script>alert("x")</script>', 'html');
    expect(html).toContain('<meta charset="utf-8">');
    const parsed = new Window().document;
    parsed.write(html);
    expect(parsed.querySelector('h1')?.textContent).toBe('</h1><script>alert("x")</script>');
    expect(parsed.querySelector('p')?.textContent).toBe('正文');
    expect(html).not.toContain('<script>');
    expect(window.document.querySelector('p')?.textContent).toBe('正文');
    window.happyDOM.abort();
  });
  test('plain text reads the latest body and includes the title', async () => {
    let body = '首行\n次行';
    const editor = { getText: () => body } as Editor;
    expect(await documentContent(editor, ' ', 'text')).toBe('无标题文档\n\n首行\n次行');
    body = '最新正文';
    expect(await documentContent(editor, '标题', 'text')).toBe('标题\n\n最新正文');
  });
});

describe('document links carry explicit resource identity', () => {
  test('link round-trip distinguishes local/server and resets unrelated routes and parameters', () => {
    for (const source of ['local', 'server'] as const) {
      const target = { knowledgeBaseId: 'kb1', pageId: 'p/1', source };
      const link = documentLink('http://localhost:3000/old?view=projects#stale', target);
      expect(readDocumentLink(link)).toEqual(target);
      expect(new URL(link).pathname).toBe('/');
      expect(new URL(link).hash).toBe('');
      expect(new URL(link).searchParams.get('view')).toBe('knowledge');
    }
  });
  test('incomplete and unknown source targets never select a document', () => {
    expect(readDocumentLink('http://localhost:3000/?document=p')).toBeNull();
    expect(
      readDocumentLink(
        'http://localhost:3000/?document=p&knowledgeBase=w&knowledgeBase=k&source=unknown',
      ),
    ).toBeNull();
  });
});

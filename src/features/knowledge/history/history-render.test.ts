import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Schema } from '@tiptap/pm/model';
import { Schema as PmSchema } from '@tiptap/pm/model';

// prosemirror-model captures the global document at import time, so the DOM
// must exist before the module graph loads.
const dom = new Window();
(globalThis as { document?: unknown }).document = dom.document;
(globalThis as { window?: unknown }).window = dom;
const { renderCheckpointHtml } = await import('./restore');

const schema = new PmSchema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'text*', toDOM: () => ['p', 0] },
    text: {},
  },
}) as Schema;
const docJson = (...texts: string[]) => schema.node('doc', null, texts.map((text) => schema.node('paragraph', null, [schema.text(text)]))).toJSON();

describe('checkpoint preview rendering (V03)', () => {
  test('serializes schema-validated nodes to HTML', () => {
    const html = renderCheckpointHtml(docJson('预览正文'), schema);
    expect(html).toContain('预览正文');
    expect(html).toContain('<p');
  });

  test('an undecodable checkpoint renders nothing', () => {
    expect(renderCheckpointHtml({ no: 'html' }, schema)).toBeNull();
  });
});

import { expect, test } from 'bun:test';
import { knowledgeSchema as schema } from './index';
import { createMarkdownPipeline } from '../markdown';

test('media alignment and image width survive portable Markdown with stable identity and old defaults', () => {
  const pipeline = createMarkdownPipeline();
  for (const type of ['image', 'whiteboard', 'mermaid', 'plantuml']) {
    expect(schema.nodeFromJSON({ type }).attrs.align).toBe(type === 'image' ? 'center' : 'left');
    for (const align of ['left', 'center', 'right']) {
      const node = schema.nodes[type].create({ blockId: 'layout-id', align, width: 42, autoWidth: false, src: 'https://example.com/image.png', source: 'graph LR\nA-->B', caption: 'Keep caption' });
      const doc = schema.nodes.doc.create(null, [node]);
      doc.check();
      expect(pipeline.parse(pipeline.serialize(doc)).toJSON()).toEqual(doc.toJSON());
    }
    for (const align of [null, 'justify', '', 1]) expect(() => schema.nodes[type].create({ align }).check()).toThrow();
  }
  for (const attrs of [{ width: 0 }, { width: 101 }, { width: 2.5 }, { autoWidth: null }]) expect(() => schema.nodes.image.create(attrs).check()).toThrow();
  expect(schema.nodeFromJSON({ type: 'image', attrs: { src: 'https://example.com/old.png' } }).attrs.autoWidth).toBe(true);
});

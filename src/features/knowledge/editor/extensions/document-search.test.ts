import { describe, expect, test } from 'bun:test';
import { Schema, type Node } from '@tiptap/pm/model';
import { findDocumentMatches } from './document-search';
const schema = new Schema({ nodes: { doc: { content: 'block+' }, paragraph: { group: 'block', content: 'inline*' }, quote: { group: 'block', content: 'block+' }, text: { group: 'inline' }, image: { group: 'inline', inline: true } }, marks: { bold: {} } });
const paragraph = (...children: Node[]) => schema.node('paragraph', null, children.flat());
describe('document search positions', () => {
  test('matches across inline marks while maintaining exact document offsets', () => {
    const doc = schema.node('doc', null, [paragraph(schema.text('前Hello', [schema.mark('bold')]), schema.text(' world 后'))]);
    const [match] = findDocumentMatches(doc, 'hello world');
    expect(doc.textBetween(match.from, match.to)).toBe('Hello world');
  });
  test('does not stitch separate blocks or inline images together', () => {
    const doc = schema.node('doc', null, [paragraph(schema.text('hello')), paragraph(schema.text('world')), paragraph(schema.text('a'), schema.node('image'), schema.text('b'))]);
    expect(findDocumentMatches(doc, 'helloworld')).toEqual([]);
    expect(findDocumentMatches(doc, 'ab')).toEqual([]);
  });
  test('finds nested content, treats regex punctuation literally and honors case', () => {
    const doc = schema.node('doc', null, [schema.node('quote', null, [paragraph(schema.text('Foo foo [a]+'))])]);
    expect(findDocumentMatches(doc, 'foo')).toHaveLength(2);
    expect(findDocumentMatches(doc, 'foo', true)).toHaveLength(1);
    expect(findDocumentMatches(doc, '[a]+')).toHaveLength(1);
    expect(findDocumentMatches(doc, '')).toEqual([]);
  });
  test('Unicode case matching never shifts offsets after uppercase dotted I', () => {
    const doc = schema.node('doc', null, [paragraph(schema.text('İ 中文'))]);
    const [match] = findDocumentMatches(doc, '中文');
    expect(doc.textBetween(match.from, match.to)).toBe('中文');
  });
});

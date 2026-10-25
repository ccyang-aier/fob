import { expect, test } from 'bun:test';
import { compareDocumentBlocks, documentTextStatistics } from './index';
const body = (...entries: [string, string][]) => ({ type: 'doc', content: entries.map(([id, text]) => ({ type: 'paragraph', attrs: { blockId: id }, content: [{ type: 'text', text }] })) });
test('stable blocks keep unchanged text aligned through additions, edits and removals', () => {
  const result = compareDocumentBlocks(body(['one', 'First'], ['two', 'Old'], ['three', 'Remove']), body(['new', 'Added'], ['one', 'First'], ['two', 'Changed']));
  expect(result).toEqual([{ kind: 'added', text: 'Added' }, { kind: 'equal', text: 'First' }, { kind: 'removed', text: 'Old' }, { kind: 'added', text: 'Changed' }, { kind: 'removed', text: 'Remove' }]);
});
test('text statistics count Unicode characters and segment Chinese and English words', () => {
  expect(documentTextStatistics(body(['one', '中文知识 English words']))).toMatchObject({ characters: 16, paragraphs: 1 });
  expect(documentTextStatistics(body(['one', '中文知识 English words'])).words).toBeGreaterThan(2);
  expect(documentTextStatistics(null)).toEqual({ characters: 0, paragraphs: 0, words: 0, readingSeconds: 0 });
});
test('formatting changes are visible and nested list paragraphs do not merge words', () => {
  const original = body(['one', 'same text']);
  const formatted = structuredClone(original) as typeof original & { content: { content: { marks?: { type: string }[] }[] }[] };
  formatted.content[0]!.content[0]!.marks = [{ type: 'bold' }];
  expect(compareDocumentBlocks(original, formatted).map(value => value.kind)).toEqual(['removed', 'added']);
  const lists = { type: 'doc', content: [{ type: 'bulletList', content: [{ type: 'listItem', content: original.content }, { type: 'listItem', content: original.content }] }] };
  expect(documentTextStatistics(lists)).toMatchObject({ words: 4, paragraphs: 2 });
});

import { expect, test } from 'bun:test';
import { inspectBlockIds } from '../schema';
import { parseTextDocument, textDocumentFormat, textDocumentTitle } from './index';

test('plain text imports as ordinary paragraphs, preserves literal syntax, blank lines and Unicode', () => {
  const document = parseTextDocument('\ufeff# literal heading\r\n\r\n中文 **literal** <script>\r\n', 'text');
  expect(document.childCount).toBe(4);
  expect(document.child(0).type.name).toBe('paragraph');
  expect(document.child(0).textContent).toBe('# literal heading');
  expect(document.child(1).content.size).toBe(0);
  expect(document.child(2).textContent).toBe('中文 **literal** <script>');
  expect(document.child(2).firstChild!.marks).toHaveLength(0);
  expect(inspectBlockIds(document)).toEqual([]);
});

test('Markdown imports into native heading, list, marks and code nodes with independent block IDs', () => {
  const source = '# Heading\n\n**Bold** and [link](https://example.com)\n\n- First\n- Second\n\n```js\nconst a = 1\n```';
  const document = parseTextDocument(source, 'markdown');
  expect(document.child(0).type.name).toBe('heading');
  expect(document.child(1).firstChild!.marks[0]!.type.name).toBe('bold');
  expect(document.child(2).type.name).toBe('bulletList');
  expect(document.child(3).type.name).toBe('codeBlock');
  expect(inspectBlockIds(document)).toEqual([]);
  expect(document.child(0).attrs.blockId).not.toBe(parseTextDocument(source, 'markdown').child(0).attrs.blockId);
});

test('native text import handles empty files and removes only supported text extensions from titles', () => {
  expect(parseTextDocument('', 'text').childCount).toBe(1);
  expect(parseTextDocument('', 'markdown').type.name).toBe('doc');
  expect(textDocumentFormat('Note.MD')).toBe('markdown');
  expect(textDocumentFormat('Note.txt')).toBe('text');
  expect(textDocumentFormat('Report.pdf')).toBeNull();
  expect(textDocumentTitle('Work.notes.txt')).toBe('Work.notes');
  expect(textDocumentTitle('Report.pdf')).toBe('Report.pdf');
});

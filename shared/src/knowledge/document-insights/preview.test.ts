import { expect, test } from 'bun:test';
import { documentPreview } from './preview';

test('preview preserves real heading, paragraphs, list text and hard breaks', () => {
  expect(documentPreview({ type: 'doc', content: [
    { type: 'heading', content: [{ type: 'text', text: '协作约定' }] },
    { type: 'paragraph', content: [{ type: 'text', text: '第一段' }, { type: 'hardBreak' }, { type: 'text', text: '下一行' }] },
    { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '待讨论事项' }] }] }] },
  ] })).toEqual({ heading: '协作约定', lines: ['第一段 下一行', '待讨论事项'], graphic: false, empty: false });
});

test('diagram payloads and source code never become invented paragraph previews', () => {
  expect(documentPreview({ type: 'doc', content: [
    { type: 'plantuml', attrs: { source: '@startuml\nsecret technical payload' } },
    { type: 'codeBlock', content: [{ type: 'text', text: 'private source code' }] },
  ] })).toEqual({ heading: null, lines: [], graphic: true, empty: false });
  expect(documentPreview({ type: 'doc', content: [{ type: 'paragraph' }] }).empty).toBe(true);
});

test('preview bounds text without mutating the body or manufacturing filler', () => {
  const body = { type: 'doc', content: Array.from({ length: 10 }, () => ({ type: 'paragraph', content: [{ type: 'text', text: '正文'.repeat(500) }] })) };
  const before = JSON.stringify(body), result = documentPreview(body);
  expect(result.lines).toHaveLength(4);
  expect(result.lines.every(line => line.length === 240)).toBe(true);
  expect(JSON.stringify(body)).toBe(before);
  expect(documentPreview(null)).toEqual({ heading: null, lines: [], graphic: false, empty: true });
});

test('only a bounded stored PNG can become a whiteboard thumbnail', () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB';
  const body = (preview: string) => ({ type: 'doc', content: [{ type: 'whiteboard', attrs: { preview } }] });
  expect(documentPreview(body(png)).image).toBe(png);
  expect(documentPreview(body('https://untrusted.example/image.png')).image).toBeUndefined();
  expect(documentPreview(body('data:image/svg+xml;base64,PHN2Zz4=')).image).toBeUndefined();
  expect(documentPreview(body(png + 'A'.repeat(400_000))).image).toBeUndefined();
});

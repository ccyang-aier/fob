/**
 * Table-driven tests of the clipboard Markdown heuristic (E06): real
 * Markdown samples (heading + list, GFM table, fenced code, task list,
 * inline-only markers, single leading list items) classify as Markdown;
 * plain Chinese/English prose, bare URLs and the empty string stay plain.
 */

import { describe, expect, test } from 'bun:test';
import { detectPasteKind } from './markdown-detect';

const CASES: readonly [string, 'markdown' | 'plain'][] = [
  // Real Markdown: two line-level markers and up.
  ['# 标题\n\n- 甲\n- 乙', 'markdown'],
  ['## 章节标题\n\n正文之前先引用一段：\n\n> 引用\n> 两行', 'markdown'],
  ['> 引用一\n> 引用二', 'markdown'],
  // Fences and GFM tables convert on a single marker.
  ['```ts\nconst answer = 42;\n```', 'markdown'],
  ['| 列一 | 列二 |\n| --- | --- |\n| 甲 | 乙 |', 'markdown'],
  ['~~~\nfenced with tildes\n~~~', 'markdown'],
  // Task lists are list lines with inline checkboxes.
  ['- [ ] 甲\n- [ ] 乙', 'markdown'],
  ['- [x] 已完成', 'markdown'],
  // A single leading list marker converts.
  ['- 单个列表项', 'markdown'],
  ['* 星号列表', 'markdown'],
  ['3. 从三开始', 'markdown'],
  // Inline-only markers.
  ['**加粗**', 'markdown'],
  ['这句话里有一段`等宽`文本', 'markdown'],
  ['看这个 [链接](https://example.com) 怎么样', 'markdown'],
  ['![图片](https://example.com/a.png)', 'markdown'],
  ['__下划线加粗__', 'markdown'],
  // Plain prose and non-Markdown payloads stay plain.
  ['这是一段普通的中文文本，没有任何标记语言结构。', 'plain'],
  ['第一行\n第二行\n第三行', 'plain'],
  ['Regular English prose with sentences. Nothing special here!', 'plain'],
  ['https://example.com/path?q=1', 'plain'],
  ['会议纪要 2026-09-26\n1、审阅上周期事项\n2、同步本周计划', 'plain'],
  ['', 'plain'],
  ['   ', 'plain'],
];

describe('detectPasteKind', () => {
  for (const [text, expected] of CASES) {
    test(`${JSON.stringify(text)} → ${expected}`, () => {
      expect(detectPasteKind(text)).toBe(expected);
    });
  }

  test('a lone heading or quote line is not enough (chat shorthand stays prose)', () => {
    expect(detectPasteKind('# 只是话题标签')).toBe('plain');
    expect(detectPasteKind('> 引用一句')).toBe('plain');
  });
});

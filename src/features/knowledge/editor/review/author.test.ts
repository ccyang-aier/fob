/**
 * Pure authorship presentation tests (S02): the stored author string — one
 * grammar for humans, agents, MCP clients and checkpoint restores (B08/B09) —
 * maps onto the badge the reviewer sees, and timestamps degrade honestly.
 */

import { describe, expect, test } from 'bun:test';
import { authorBadgeGlyph, describeSuggestionAuthor, formatSuggestionTime } from './author';

describe('describeSuggestionAuthor', () => {
  test('machine sources carry their kind, label and identifier', () => {
    expect(describeSuggestionAuthor('agent:task_9')).toEqual({
      kind: 'agent',
      label: 'AI 助手',
      source: 'AI 任务',
      detail: 'task_9',
    });
    expect(describeSuggestionAuthor('mcp:Claude%20Desktop:call_1')).toEqual({
      kind: 'mcp',
      label: 'Claude Desktop',
      source: 'MCP 客户端',
      detail: 'call_1',
    });
    expect(describeSuggestionAuthor('restore:ckpt_2f')).toEqual({
      kind: 'restore',
      label: '检查点恢复',
      source: '检查点',
      detail: 'ckpt_2f',
    });
  });

  test('human origins stay generic; user names and unknown shapes stay honest', () => {
    expect(describeSuggestionAuthor('human:window_7')).toMatchObject({
      kind: 'human',
      label: '成员',
      source: '本人输入',
    });
    expect(describeSuggestionAuthor('user:张三')).toMatchObject({
      kind: 'human',
      label: '张三',
      source: '本人输入',
    });
    // Unparseable strings present the raw value instead of inventing a source.
    expect(describeSuggestionAuthor('李四')).toMatchObject({ kind: 'human', label: '李四' });
    expect(describeSuggestionAuthor('')).toMatchObject({ kind: 'human', label: '成员' });
  });

  test('badge glyphs are the compact in-text chips', () => {
    expect(authorBadgeGlyph('human')).toBe('人');
    expect(authorBadgeGlyph('agent')).toBe('AI');
    expect(authorBadgeGlyph('mcp')).toBe('MCP');
    expect(authorBadgeGlyph('restore')).toBe('CP');
  });
});

describe('formatSuggestionTime', () => {
  const now = new Date('2026-09-26T12:00:00+08:00');

  test('English uses singular and plural units and preserves raw timestamps', () => {
    expect(formatSuggestionTime('2026-09-26T11:59:00+08:00', now, 'en-US')).toBe('1 minute ago');
    expect(formatSuggestionTime('2026-09-26T10:00:00+08:00', now, 'en-US')).toBe('2 hours ago');
    expect(formatSuggestionTime('2026-09-25T12:00:00+08:00', now, 'en-US')).toBe('1 day ago');
    expect(formatSuggestionTime('用户时间备注', now, 'en-US')).toBe('用户时间备注');
  });

  test('buckets elapsed time the way a reviewer reads it', () => {
    expect(formatSuggestionTime('2026-09-26T11:59:40+08:00', now)).toBe('刚刚');
    expect(formatSuggestionTime('2026-09-26T11:55:00+08:00', now)).toBe('5 分钟前');
    expect(formatSuggestionTime('2026-09-26T09:00:00+08:00', now)).toBe('3 小时前');
    expect(formatSuggestionTime('2026-09-24T12:00:00+08:00', now)).toBe('2 天前');
  });

  test('falls back to a local date (year only when it differs) and passes unparseable values through', () => {
    // The fallback renders in the viewer's local timezone; the expected
    // string is derived from the same Date so the test is TZ-independent.
    const time = Date.parse('2026-09-12T08:30:00+08:00');
    const date = new Date(time);
    const hhmm = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    expect(formatSuggestionTime('2026-09-12T08:30:00+08:00', now)).toBe(`09/12 ${hhmm}`);
    const otherYear = new Date(Date.parse('2025-09-12T08:30:00+08:00'));
    expect(formatSuggestionTime('2025-09-12T08:30:00+08:00', now)).toBe(
      `2025/09/12 ${String(otherYear.getHours()).padStart(2, '0')}:${String(otherYear.getMinutes()).padStart(2, '0')}`,
    );
    expect(formatSuggestionTime('yesterday', now)).toBe('yesterday');
  });

  test('a future timestamp clamps to 刚刚 instead of going negative', () => {
    expect(formatSuggestionTime('2026-09-26T12:01:00+08:00', now)).toBe('刚刚');
  });
});

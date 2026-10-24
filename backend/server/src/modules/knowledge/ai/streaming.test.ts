import { describe, expect, test } from 'bun:test';
import { MarkdownStreamSplitter } from './streaming';

/** §9.3「每完成一个块就写入一次」的切分器：确定性单元行为。 */
describe('markdown stream splitter', () => {
  test('blank-line boundaries emit complete blocks; incomplete tails wait', () => {
    const splitter = new MarkdownStreamSplitter();
    expect(splitter.push('第一段尚未')).toEqual([]);
    expect(splitter.push('结束\n\n')).toEqual(['第一段尚未结束']);
    expect(splitter.push('## 标题\n\n- 列表项\n- 另一项\n\n')).toEqual(['## 标题', '- 列表项\n- 另一项']);
    expect(splitter.push('残段')).toEqual([]);
    expect(splitter.flush()).toBe('残段');
    expect(splitter.flush()).toBeNull();
  });

  test('blank lines inside fenced code blocks are not boundaries, across delta splits', () => {
    const splitter = new MarkdownStreamSplitter();
    expect(splitter.push('```js\nfunction a() {\n')).toEqual([]);
    expect(splitter.push('  return 1;\n\n')).toEqual([]);
    expect(splitter.push('}\n```\n\n')).toEqual(['```js\nfunction a() {\n  return 1;\n\n}\n```']);
  });

  test('leading blank noise is consumed, whitespace-only flush is dropped', () => {
    const splitter = new MarkdownStreamSplitter();
    expect(splitter.push('\n\n  \n正文\n\n')).toEqual(['正文']);
    expect(splitter.push('   \n\t\n')).toEqual([]);
    expect(splitter.flush()).toBeNull();
  });

  test('a single trailing newline is a soft break, not a block boundary', () => {
    const splitter = new MarkdownStreamSplitter();
    expect(splitter.push('同一句的上半\n')).toEqual([]);
    expect(splitter.push('下半\n\n')).toEqual(['同一句的上半\n下半']);
  });
});

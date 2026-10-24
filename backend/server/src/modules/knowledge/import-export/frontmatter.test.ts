import { describe, expect, test } from 'bun:test';
import { VaultFrontmatterError, decodeFrontmatter, encodeFrontmatter, splitFrontmatter } from './frontmatter';

describe('M03 splitFrontmatter', () => {
  test('extracts a first-line fenced block and keeps the body verbatim', () => {
    expect(splitFrontmatter('---\nicon: 📌\n---\n正文\n\n第二段\n')).toEqual({ frontmatter: 'icon: 📌', body: '正文\n\n第二段\n' });
    expect(splitFrontmatter('---\na: 1\n...\n正文')).toEqual({ frontmatter: 'a: 1', body: '正文' });
  });

  test('missing or unclosed fences leave the source untouched as body', () => {
    expect(splitFrontmatter('普通正文\n---\n不是围栏')).toEqual({ frontmatter: null, body: '普通正文\n---\n不是围栏' });
    expect(splitFrontmatter('---\nicon: 📌\n正文没有关闭')).toEqual({ frontmatter: null, body: '---\nicon: 📌\n正文没有关闭' });
    expect(splitFrontmatter('--- \nicon: 📌\n---\n正文')).toEqual({ frontmatter: null, body: '--- \nicon: 📌\n---\n正文' });
  });
});

describe('M03 decodeFrontmatter: the strict property subset', () => {
  test('accepts strings, finite numbers, booleans, null and string lists', () => {
    expect(decodeFrontmatter('status: done\nrank: 2.5\npinned: false\nquiet: null\ntags:\n  - a\n  - b')).toEqual({
      properties: { status: 'done', rank: 2.5, pinned: false, quiet: null, tags: ['a', 'b'] },
      icon: null,
    });
  });

  test('reserves icon for the page icon and validates it', () => {
    expect(decodeFrontmatter('icon: 🧠')).toEqual({ properties: {}, icon: '🧠' });
    expect(() => decodeFrontmatter('icon: 3')).toThrow(VaultFrontmatterError);
    expect(() => decodeFrontmatter('icon: ""')).toThrow(VaultFrontmatterError);
    expect(() => decodeFrontmatter(`icon: "${'x'.repeat(201)}"`)).toThrow(VaultFrontmatterError);
  });

  test('empty or null frontmatter decodes to an empty page', () => {
    expect(decodeFrontmatter('')).toEqual({ properties: {}, icon: null });
    expect(decodeFrontmatter('~')).toEqual({ properties: {}, icon: null });
  });

  test('rejects invalid YAML, non-map roots, unsupported value types and contract-breaking keys', () => {
    const expectReason = (text: string, reason: InstanceType<typeof VaultFrontmatterError>['reason']) => {
      try {
        decodeFrontmatter(text);
        throw new Error('expected a VaultFrontmatterError');
      } catch (cause) {
        expect(cause).toBeInstanceOf(VaultFrontmatterError);
        expect((cause as VaultFrontmatterError).reason).toBe(reason);
      }
    };
    expectReason('icon: [1', 'syntax');
    expectReason('- a\n- b', 'shape');
    expectReason('nested:\n  key: value', 'value_type');
    expectReason('nums:\n  - 1\n  - 2', 'value_type');
    expectReason('infinity: .inf', 'value_type');
    expectReason('"date created": 2026-01-01', 'property_id');
    // 裸日期在 YAML 1.2 core schema 下保持字符串,属于受支持的子集。
    expect(decodeFrontmatter('when: 2026-01-01')).toEqual({ properties: { when: '2026-01-01' }, icon: null });
  });
});

describe('M03 encodeFrontmatter: deterministic output', () => {
  test('omits the fence entirely for empty pages and sorts keys deterministically', () => {
    expect(encodeFrontmatter({ properties: {}, icon: null })).toBeNull();
    const first = encodeFrontmatter({ properties: { tags: ['x'], status: 'ok' }, icon: null })!;
    const second = encodeFrontmatter({ properties: { status: 'ok', tags: ['x'] }, icon: null })!;
    expect(first).toBe(second);
    expect(first).toBe('---\nstatus: ok\ntags:\n  - x\n---\n');
  });

  test('icon comes first and the fence round trips through decode', () => {
    const encoded = encodeFrontmatter({ properties: { rank: 1 }, icon: '🌟' })!;
    expect(encoded.startsWith('---\nicon: 🌟\n')).toBe(true);
    expect(decodeFrontmatter(encoded.slice(3, encoded.length - 4).trimEnd())).toEqual({ properties: { rank: 1 }, icon: '🌟' });
  });
});

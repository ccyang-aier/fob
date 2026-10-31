import { expect, test } from 'bun:test';
import { THEMES } from 'beautiful-mermaid';
import { mermaidPalette, mermaidPalettes, mermaidTheme } from './mermaid-theme';

test('only the two native GitHub themes are active and match the exact upstream palettes', () => {
  expect(Object.keys(mermaidPalettes).sort()).toEqual(['github-dark', 'github-light']);
  for (const dark of [false, true]) {
    const preset = dark ? 'github-dark' : 'github-light';
    expect(mermaidPalette(dark)).toEqual(THEMES[preset]);
    expect(mermaidTheme(dark)).toEqual({ ...THEMES[preset], font: 'Inter', padding: 8 });
  }
});

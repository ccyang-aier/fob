import { expect, test } from 'bun:test';
import { MERMAID_THEMES } from '@fob/shared/knowledge/rich-content';
import { mermaidTheme } from './mermaid-theme';

function luminance(hex: string) {
  const [r, g, b] = hex.slice(1).match(/../g)!.map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string) {
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

for (const theme of MERMAID_THEMES) {
  for (const dark of [false, true]) {
    test(`${theme} ${dark ? 'dark' : 'light'} distinguishes content roles with readable text`, () => {
      const { themeVariables: color } = mermaidTheme(dark, theme);
      expect(new Set([color.primaryColor, color.secondaryColor, color.clusterBkg]).size).toBe(3);
      for (const [text, fill] of [
        [color.primaryTextColor, color.primaryColor],
        [color.secondaryTextColor, color.secondaryColor],
        [color.tertiaryTextColor, color.clusterBkg],
        [color.noteTextColor, color.noteBkgColor],
      ]) expect(contrast(text, fill)).toBeGreaterThanOrEqual(4.5);

      if (theme === 'mono') {
        for (const fill of [color.primaryColor, color.secondaryColor, color.clusterBkg]) {
          const channels = fill.slice(1).match(/../g);
          expect(new Set(channels).size).toBe(1);
        }
      }
    });
  }
}

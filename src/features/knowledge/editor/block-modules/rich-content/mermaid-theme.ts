import type { DiagramColors, RenderOptions } from 'beautiful-mermaid';

/** beautiful-mermaid 1.1.3 GitHub palettes. The renderer stays lazy-loaded.
 * Copyright (c) 2026 Craft Docs, MIT; see /licenses/beautiful-mermaid.txt. */
export const mermaidPalettes = {
  'github-light': { bg: '#ffffff', fg: '#1f2328', line: '#d1d9e0', accent: '#0969da', muted: '#59636e' },
  'github-dark': { bg: '#0d1117', fg: '#e6edf3', line: '#3d444d', accent: '#4493f8', muted: '#9198a1' },
} satisfies Record<string, DiagramColors>;

export function mermaidPalette(dark: boolean): DiagramColors {
  return mermaidPalettes[dark ? 'github-dark' : 'github-light'];
}

export function mermaidTheme(dark: boolean): RenderOptions {
  return { ...mermaidPalette(dark), font: 'Inter', padding: 8 };
}

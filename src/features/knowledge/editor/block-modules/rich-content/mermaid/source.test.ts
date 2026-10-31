import { expect, test } from 'bun:test';
import { finishMermaidSvg, prepareMermaidSource } from './source';

test('renderer normalization preserves source authority and separates Mermaid-only metadata', () => {
  const source = '---\ntitle: "My flow"\nconfig:\n  layout: dagre\n---\n%%{init: {"theme":"forest"}}%%\n%% comment\nflowchart LR\n accTitle: A & B\n accDescr {\n  A diagram with a loop\n }\n A --> B';
  const result = prepareMermaidSource(source);
  expect({ ...result, text: result.text.split('\n').filter(line => line.trim()).join('\n') })
    .toEqual({ text: 'flowchart LR\n A --> B', title: 'A & B', description: 'A diagram with a loop', compatible: true });
  expect(source).toContain('layout: dagre');
  expect(prepareMermaidSource('---\ntitle: "My flow"\n---\nflowchart LR\n A --> B').title).toBe('My flow');
});

test('unsupported kinds and extended shapes retain the compatibility path', () => {
  for (const source of ['pie\n "A": 10', 'mindmap\n root', 'flowchart TD\n A@{ shape: doc }', 'flowchart LR\n A --> B\n click A "https://example.com"',
    'flowchart LR\n 用户 --> 系统', 'flowchart LR\n A --> B; B --> C', 'flowchart LR\n A -->']) {
    expect(prepareMermaidSource(source).compatible).toBe(false);
  }
  expect(prepareMermaidSource('%% comment\nsequenceDiagram\n A->>B: Hi').compatible).toBe(true);
});

test('standalone SVG metadata escapes markup and literal replacement sequences without duplicating roles', () => {
  const title = '$& <title>"unsafe"</title>';
  const svg = finishMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg" role="graphics-document"></svg>', 'mermaid', title, 'A & B');
  expect(svg.match(/role=/g)).toHaveLength(1);
  expect(svg).toContain('<title>$&amp; &lt;title&gt;&quot;unsafe&quot;&lt;/title&gt;</title>');
  expect(svg).toContain('<desc>A &amp; B</desc>');
});

test('upstream SVGs keep their variable-based theme while removing remote font dependencies', () => {
  const svg = finishMermaidSvg('<svg><style>@import url(\'https://fonts.googleapis.com/font\'); svg{--fg:#333}</style></svg>', 'beautiful-mermaid');
  expect(svg).not.toContain('@import');
  expect(svg).not.toContain('fonts.googleapis.com');
  expect(svg).toContain('svg{--fg:#333}');
  expect(svg).toContain('role="img"');
});

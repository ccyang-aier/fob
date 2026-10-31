import { expect, mock, test } from 'bun:test';
import type { MermaidConfig } from 'mermaid';

let active: MermaidConfig;
mock.module('mermaid', () => ({ default: {
  initialize(config: MermaidConfig) { active = config; },
  async render(id: string, source: string) {
    await new Promise(resolve => setTimeout(resolve, 5));
    if (source === 'invalid') throw new Error('Invalid diagram');
    return { svg: `<svg id="${id}" role="graphics-document" fill="${active.themeVariables.primaryColor}" data-dark="${active.themeVariables.darkMode}"/>` };
  },
} }));

const { renderMermaid } = await import('./runtime');
const { svgGraphicSize } = await import('../graphic-preview/size');

test('a simple diagram supplies a compact intrinsic width without scaling it to the document width', async () => {
  const size = svgGraphicSize(await renderMermaid('compact', 'flowchart LR\n A[Start] --> B[Done]', false))!;
  expect(size.width).toBeGreaterThan(100);
  expect(size.width).toBeLessThan(400);
  expect(size.height).toBeGreaterThan(30);
});

test('complex Chinese flowcharts use beautiful-mermaid layout and retain groups, shapes, edges and metadata', async () => {
  const svg = await renderMermaid('complex', `---
title: Team knowledge
config:
  layout: dagre
---
%% A normal Mermaid comment
flowchart TB
  accTitle: 协作与知识复用
  accDescr: 分组、判断与补充回路
  subgraph capture["收集"]
    direction LR
    A([开始]) --> B["记录资料"]
    B --> C{"完整？"}
    C -->|补充| D["补齐来源"]
    D -.-> B
  end
  subgraph reuse["复用"]
    E[("知识库")] --> F["搜索与分享"]
  end
  capture -->|发布| reuse`, false);
  expect(svg).toContain('data-fob-mermaid-renderer="beautiful-mermaid"');
  expect(svg.match(/class="node"/g)).toHaveLength(6);
  expect(svg.match(/class="subgraph"/g)).toHaveLength(2);
  expect(svg).toContain('data-shape="diamond"');
  expect(svg).toContain('data-shape="cylinder"');
  expect(svg).toContain('<title>协作与知识复用</title>');
  expect(svg).toContain('<desc>分组、判断与补充回路</desc>');
  expect(svg).not.toContain('accTitle');
  expect(svg).not.toContain('@import');
  expect(svg).not.toContain('fonts.googleapis.com');
});

for (const [type, source, marker] of [
  ['state', 'stateDiagram-v2\n [*] --> Idle\n Idle --> Active\n Active --> [*]', 'data-shape="state-start"'],
  ['sequence', 'sequenceDiagram\n Alice->>Bob: Hello\n Bob-->>Alice: Done', 'class="actor"'],
  ['class', 'classDiagram\n Animal <|-- Duck\n Animal: +int age', 'class="class-node"'],
  ['ER', 'erDiagram\n CUSTOMER ||--o{ ORDER : places', 'class="entity"'],
  ['XY', 'xychart-beta\n x-axis [Jan, Feb]\n bar [10, 20]', '--xychart-color-0'],
]) test(`${type} diagrams use the upstream renderer`, async () => {
  const svg = await renderMermaid(type, source, false);
  expect(svg).toContain('data-fob-mermaid-renderer="beautiful-mermaid"');
  expect(svg).toContain(marker);
  expect(svg).not.toContain('@import');
});

test('source styling and XML escaping are retained by the new renderer', async () => {
  const svg = await renderMermaid('styled', 'flowchart LR\n A["<script>alert(1)</script>"] --> B[Done]\n style B fill:#123456,color:#ffffff', false);
  expect(svg).toContain('data-fob-mermaid-renderer="beautiful-mermaid"');
  expect(svg).toContain('fill="#123456"');
  expect(svg).toContain('&lt;script&gt;');
  expect(svg).not.toContain('<script>');
});

test('simultaneous upstream renders keep independent system appearances', async () => {
  const [light, dark] = await Promise.all([
    renderMermaid('light', 'flowchart LR\n A --> B', false),
    renderMermaid('dark', 'flowchart LR\n A --> B', true),
  ]);
  expect(light).toContain('--bg:#ffffff');
  expect(dark).toContain('--bg:#0d1117');
});

test('Mermaid-only diagrams preserve serialized fallback themes and recover after an invalid diagram', async () => {
  const results = await Promise.allSettled([
    renderMermaid('pie-light', 'pie\n "A" : 1', false),
    renderMermaid('broken', 'invalid', false),
    renderMermaid('pie-dark', 'pie\n "B" : 2', true),
  ]);
  expect(results[1].status).toBe('rejected');
  for (const [index, color] of [[0, '#ffffff'], [2, '#0d1117']] as const) {
    const result = results[index];
    expect(result.status).toBe('fulfilled');
    if (result.status === 'fulfilled') {
      expect(result.value).toContain(`fill="${color}"`);
      expect(result.value).toContain(`data-dark="${index === 2}"`);
      expect(result.value.match(/role=/g)).toHaveLength(1);
      expect(result.value).toContain('data-fob-mermaid-renderer="mermaid"');
    }
  }
});

test('the public renderer keeps the source size limit before importing an engine', async () => {
  await expect(renderMermaid('too-large', 'A'.repeat(50_001), false)).rejects.toThrow('50,000');
});

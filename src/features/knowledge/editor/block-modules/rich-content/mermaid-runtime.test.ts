import { expect, mock, test } from 'bun:test';
import type { MermaidConfig } from 'mermaid';

let active: MermaidConfig;
mock.module('mermaid', () => ({ default: {
  initialize(config: MermaidConfig) { active = config; },
  async render(id: string, source: string) {
    // Deliberately yield after configuration: uncoordinated renders would read the next block's theme.
    await new Promise(resolve => setTimeout(resolve, 5));
    if (source === 'invalid') throw new Error('Invalid diagram');
    return { svg: `<svg id="${id}" fill="${active.themeVariables.primaryColor}"/>` };
  },
} }));

const { renderMermaid } = await import('./mermaid-runtime');

test('simultaneous Mermaid blocks keep independent themes and light/dark modes', async () => {
  const [blue, green] = await Promise.all([
    renderMermaid('blue', 'flowchart LR\n A --> B', false, 'blue'),
    renderMermaid('green', 'flowchart LR\n A --> B', true, 'green'),
  ]);
  expect(blue).toContain('#eef4fb');
  expect(green).toContain('#213a2e');
});

test('an invalid diagram does not block rendering the next themed block', async () => {
  const [broken, next] = await Promise.allSettled([
    renderMermaid('broken', 'invalid', false, 'blue'),
    renderMermaid('next', 'flowchart LR\n A --> B', false, 'violet'),
  ]);
  expect(broken.status).toBe('rejected');
  expect(next.status).toBe('fulfilled');
  if (next.status === 'fulfilled') expect(next.value).toContain('#f3effb');
});

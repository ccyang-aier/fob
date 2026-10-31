import type { MermaidTheme } from '@fob/shared/knowledge/rich-content';
import { mermaidTheme } from './mermaid-theme';

let engine: Promise<typeof import('mermaid')> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Mermaid has global configuration; keep initialization and rendering in the same serialized job. */
export function renderMermaid(id: string, source: string, dark: boolean, theme: MermaidTheme): Promise<string> {
  const result = queue.then(async () => {
    const renderer = await (engine ??= import('mermaid').catch(cause => { engine = undefined; throw cause; }));
    renderer.default.initialize(mermaidTheme(dark, theme));
    const rendered = await renderer.default.render(id, source);
    return rendered.svg;
  });
  queue = result.catch(() => undefined);
  return result;
}

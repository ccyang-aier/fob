import { mermaidTheme } from './theme';
import { finishMermaidSvg, prepareMermaidSource } from './source';

let engine: Promise<typeof import('beautiful-mermaid')> | undefined;

export async function renderMermaid(id: string, source: string, dark: boolean): Promise<string> {
  const prepared = prepareMermaidSource(source);
  if (prepared.compatible) {
    const renderer = await (engine ??= import('beautiful-mermaid').catch(cause => { engine = undefined; throw cause; }));
    try {
      const svg = renderer.renderMermaidSVG(prepared.text, mermaidTheme(dark));
      if (/^(?:graph|flowchart|stateDiagram)\b/i.test(prepared.text) && !svg.includes('class="node"')) throw new Error('Unsupported graph syntax');
      return finishMermaidSvg(svg, 'beautiful-mermaid', prepared.title, prepared.description);
    } catch {
      // Mermaid accepts more syntax than the upstream parser. Keep valid existing diagrams readable.
    }
  }
  const { renderCompatibleMermaid } = await import('./compat');
  return finishMermaidSvg(await renderCompatibleMermaid(id, source, dark), 'mermaid');
}

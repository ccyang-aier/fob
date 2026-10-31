/** Renderer-only normalization. The exact Mermaid source remains the document's authority. */
export function prepareMermaidSource(source: string) {
  if (source.length > 50_000) throw new RangeError('Mermaid source exceeds 50,000 characters');
  let text = source.replace(/^\uFEFF/, '').trim();
  const frontmatter = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\s*\r?\n|$)/.exec(text);
  const title = /^\s*accTitle\s*:\s*(.+)$/m.exec(text)?.[1]
    ?? /^title:\s*["']?(.+?)["']?\s*$/m.exec(frontmatter?.[1] ?? '')?.[1];
  const description = /^\s*accDescr\s*:\s*(.+)$/m.exec(text)?.[1]
    ?? /^\s*accDescr\s*\{([\s\S]*?)^\s*\}/m.exec(text)?.[1]?.trim();
  if (frontmatter) text = text.slice(frontmatter[0].length);
  text = text.replace(/^\s*%%\{[\s\S]*?\}%%\s*$/gm, '')
    .replace(/^\s*%%.*$/gm, '')
    .replace(/^\s*accDescr\s*\{[\s\S]*?^\s*\}\s*$/gm, '')
    .replace(/^\s*acc(?:Title|Descr)\s*:.*$/gm, '').trim();
  const supported = /^(?:(?:graph|flowchart)\s+(?:TD|TB|LR|BT|RL)\b|stateDiagram(?:-v2)?\b|sequenceDiagram\b|classDiagram\b|erDiagram\b|xychart(?:-beta)?\b)/i.test(text);
  // The upstream graph parser can silently skip statement separators or non-ASCII identifiers.
  // Mask labels before checking: Chinese display text remains fully supported by the new renderer.
  const graph = /^(?:graph|flowchart)\b/i.test(text);
  const identifiers = text.replace(/"(?:[^"\\]|\\.)*"|\[[^\]]*\]|\{[^}]*\}|\([^)]*\)|\|[^|]*\|/g, '');
  const unsupportedGraph = graph && (/[;\u0080-\uFFFF]/.test(identifiers) || /(?:-->|==>|-\.->)\s*$/m.test(identifiers));
  const compatible = supported && !unsupportedGraph && !/@\{|^\s*(?:click|icon)\b/m.test(text);
  return { text, title, description, compatible };
}

export function finishMermaidSvg(svg: string, renderer: 'beautiful-mermaid' | 'mermaid', title?: string, description?: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
  // The upstream renderer includes Google Fonts imports. SVG images use local fallback fonts offline.
  return svg.replace(/@import\s+url\([^)]*\)\s*;/g, '')
    .replace(/<svg\b([^>]*)>/, (_root, attrs: string) =>
      `<svg data-fob-mermaid-renderer="${renderer}"${/\brole=/.test(attrs) ? '' : ' role="img"'}${attrs}>`
      + (title ? `<title>${escape(title)}</title>` : '') + (description ? `<desc>${escape(description)}</desc>` : ''));
}

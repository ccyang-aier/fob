export type DocumentPreview = { heading: string | null; lines: string[]; graphic: boolean; empty: boolean; image?: string };
type PreviewNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: PreviewNode[] };

/** A short, plain-text view of real body blocks; source code and media payloads stay out. */
export function documentPreview(body: unknown): DocumentPreview {
  const result: DocumentPreview = { heading: null, lines: [], graphic: false, empty: true };
  if (!body || typeof body !== 'object') return result;
  function text(node: PreviewNode): string {
    if (node.type === 'hardBreak') return ' ';
    return node.text ?? (node.content ?? []).map(text).join('');
  }
  function visit(node: PreviewNode) {
    const type = node.type?.replace(/Block$/i, '').toLowerCase();
    if (['whiteboard', 'excalidraw', 'mermaid', 'plantuml', 'drawio', 'image', 'file', 'pdf', 'video', 'audio'].includes(type ?? '')) {
      const preview = node.attrs?.preview;
      if (!result.image && type === 'whiteboard' && typeof preview === 'string' && preview.length <= 400_000 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z\d+/=]*$/.test(preview)) result.image = preview;
      result.graphic = true; result.empty = false; return;
    }
    if (node.type === 'codeBlock') { result.empty = false; return; }
    if (node.type === 'paragraph' || node.type === 'heading') {
      const value = text(node).replace(/\s+/g, ' ').trim();
      if (!value) return;
      result.empty = false;
      if (node.type === 'heading' && !result.heading) result.heading = value.slice(0, 180);
      else if (result.lines.length < 4) result.lines.push(value.slice(0, 240));
      return;
    }
    if (node.type && node.type !== 'doc') result.empty = false;
    for (const child of node.content ?? []) visit(child);
  }
  visit(body as PreviewNode);
  return result;
}

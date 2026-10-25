export interface DocumentBlockText { id: string; text: string; signature: string }
type JsonNode = { type?: string; text?: string; attrs?: Record<string, unknown>; content?: JsonNode[] };
function textOf(node: JsonNode): string {
  if (node.type === 'hardBreak') return '\n';
  return node.text ?? (node.content ?? []).map(textOf).join(['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '') ? '' : '\n');
}
export function documentBlocks(body: unknown): DocumentBlockText[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as JsonNode;
  return (root.content ?? []).flatMap((node, index) => node.type === 'paragraph' && !textOf(node).trim() ? [] : [{ id: typeof node.attrs?.blockId === 'string' ? node.attrs.blockId : `block-${index}`, text: textOf(node) || [node.attrs?.name, node.attrs?.alt, node.attrs?.title].find((value): value is string => typeof value === 'string') || '', signature: JSON.stringify(node) }]);
}
export function documentTextStatistics(body: unknown) {
  const text = body && typeof body === 'object' ? textOf(body as JsonNode) : '';
  const words = [...new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)].filter(segment => segment.isWordLike).length;
  let paragraphs = 0;
  function count(node: JsonNode) {
    if (['paragraph', 'heading', 'codeBlock'].includes(node.type ?? '') && textOf(node).trim()) paragraphs++;
    for (const child of node.content ?? []) count(child);
  }
  if (body && typeof body === 'object') count(body as JsonNode);
  return { characters: Array.from(text.replace(/\s/g, '')).length, words, paragraphs, readingSeconds: Math.ceil(words / 200 * 60) };
}
export interface DocumentDifference { kind: 'equal' | 'added' | 'removed'; text: string }
/** Linear in document size. Stable block identities keep unchanged paragraphs aligned. */
export function compareDocumentBlocks(before: unknown, after: unknown): DocumentDifference[] {
  const previous = documentBlocks(before), next = documentBlocks(after);
  const locations = new Map(next.map((block, index) => [block.id, index]));
  const differences: DocumentDifference[] = [];
  let position = 0;
  for (const block of previous) {
    const match = locations.get(block.id);
    if (match === undefined || match < position) { differences.push({ kind: 'removed', text: block.text }); continue; }
    while (position < match) differences.push({ kind: 'added', text: next[position++].text });
    const current = next[position++];
    if (current.text === block.text && current.signature === block.signature) differences.push({ kind: 'equal', text: block.text });
    else differences.push({ kind: 'removed', text: block.text }, { kind: 'added', text: current.text });
  }
  while (position < next.length) differences.push({ kind: 'added', text: next[position++].text });
  return differences;
}

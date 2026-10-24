import type { PdfCommentAnchor } from '@fob/shared/knowledge/contracts';
export type PdfRect = PdfCommentAnchor['pages'][number]['rects'][number];
export function normalizePdfRect(rect: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom'>, page: Pick<DOMRect, 'left' | 'top' | 'right' | 'bottom' | 'width' | 'height'>): PdfRect | null {
  const left = Math.max(rect.left, page.left), top = Math.max(rect.top, page.top);
  const right = Math.min(rect.right, page.right), bottom = Math.min(rect.bottom, page.bottom);
  if (right - left < 1 || bottom - top < 1 || !page.width || !page.height) return null;
  return { x: (left - page.left) / page.width, y: (top - page.top) / page.height, width: (right - left) / page.width, height: (bottom - top) / page.height };
}
/** TextLayer can report parent and child rectangles; coalesce each line. */
export function mergePdfRects(rects: PdfRect[]): PdfRect[] {
  const result: PdfRect[] = [];
  for (const rect of rects.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const previous = result.find(item => Math.abs(item.y - rect.y) < .003 && Math.abs(item.height - rect.height) < .004 && rect.x <= item.x + item.width + .004 && rect.x + rect.width >= item.x);
    if (previous) { const right = Math.max(previous.x + previous.width, rect.x + rect.width); previous.x = Math.min(previous.x, rect.x); previous.width = right - previous.x; }
    else result.push({ ...rect });
  }
  return result;
}
export function readPdfSelection(host: HTMLElement, assetHash: string): { anchor: PdfCommentAnchor; x: number; y: number; button: { left: number; top: number } } | null {
  const selection = host.ownerDocument.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount || !selection.anchorNode || !selection.focusNode) return null;
  const textLayer = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-pdf-text]');
  if (!host.contains(textLayer(selection.anchorNode) ?? null) || !host.contains(textLayer(selection.focusNode) ?? null)) return null;
  const quote = selection.toString().trim();
  if (!quote || quote.length > 50_000) return null;
  const range = selection.getRangeAt(0);
  const visibleBounds = host.getBoundingClientRect();
  let firstVisibleRect: DOMRect | undefined;
  let firstRect: DOMRect | undefined;
  const pages: PdfCommentAnchor['pages'] = [];
  for (const element of host.querySelectorAll<HTMLElement>('[data-pdf-page]')) {
    const text = element.querySelector('[data-pdf-text]');
    if (!text || !range.intersectsNode(text)) continue;
    // Read leaf text ranges only. A range spanning multiple runs also reports
    // enclosing span/container boxes, which would highlight unselected content.
    const clientRects: DOMRect[] = [];
    const walker = host.ownerDocument.createTreeWalker(text, 4);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (!node.textContent?.trim() || !range.intersectsNode(node)) continue;
      const fragment = host.ownerDocument.createRange(); fragment.selectNodeContents(node);
      if (node === range.startContainer) fragment.setStart(node, range.startOffset);
      if (node === range.endContainer) fragment.setEnd(node, range.endOffset);
      if (!fragment.collapsed) clientRects.push(...fragment.getClientRects());
    }
    firstRect ??= clientRects[0];
    firstVisibleRect ??= clientRects.find(rect => rect.bottom > visibleBounds.top && rect.top < visibleBounds.bottom && rect.right > visibleBounds.left && rect.left < visibleBounds.right);
    const bounds = element.getBoundingClientRect();
    const rects = mergePdfRects(clientRects.map(rect => normalizePdfRect(rect, bounds)).filter((rect): rect is PdfRect => rect !== null));
    if (rects.length && rects.length <= 200) pages.push({ page: Number(element.dataset.pdfPage), rects });
  }
  if (!pages.length || pages.length > 32) return null;
  const rect = firstVisibleRect ?? firstRect!;
  const x = (rect.left + rect.right) / 2;
  return { anchor: { assetHash, quote, pages }, x, y: rect.top, button: {
    left: Math.max(visibleBounds.left + 8, Math.min(x - 38, visibleBounds.right - 84)),
    top: Math.max(visibleBounds.top + 8, Math.min(rect.top - 38, visibleBounds.bottom - 38)),
  } };
}

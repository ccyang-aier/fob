/**
 * Long-document positioning for the review UI (S02): turning a suggestion's
 * ProseMirror position into a scroll action. The pure halves — anchor choice,
 * top-level block resolution and the scroll math — are DOM-free and tested;
 * the two DOM helpers stay thin lookups the panel's locate action performs on
 * the live view, so a relative position shifted by later edits (the CRDT can
 * move a suggestion at any time) always resolves against the current DOM.
 */

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

/** The uppermost position of a suggestion: where locating aims. */
export function suggestionAnchor(summary: { ranges: { from: number }[] }): number {
  return summary.ranges.reduce((min, range) => Math.min(min, range.from), Number.MAX_SAFE_INTEGER);
}

/**
 * Resolves any inner position (inside a list item, a table cell, …) to the
 * top-level block that contains it. Suggestions can live arbitrarily deep;
 * this gives the locator a stable outer block span for statistics and tests.
 */
export function topLevelBlockRange(doc: ProseMirrorNode, pos: number): { index: number; from: number; to: number } {
  const $pos = doc.resolve(pos);
  if ($pos.depth === 0) {
    // The position sits between top-level blocks: aim at the block after it,
    // or the last block when the position is at the document end.
    const index = Math.min($pos.index(0), doc.childCount - 1);
    let from = 0;
    for (let child = 0; child < index; child += 1) from += doc.child(child).nodeSize;
    return { index, from, to: from + doc.child(index).nodeSize };
  }
  const from = $pos.before(1);
  const node = $pos.node(1);
  return { index: $pos.index(0), from, to: from + node.nodeSize };
}

/**
 * The scroll target for one element's rectangle, or `null` when it is already
 * comfortably visible. The target lands at `ratio` of the viewport height from
 * the top, so the suggestion is read in context rather than pinned to an edge.
 */
export function scrollTargetFor(
  viewport: { scrollTop: number; height: number; maxScrollTop?: number },
  target: { top: number; bottom: number },
  ratio = 0.28,
): number | null {
  const breathing = 8;
  const visible = target.top - viewport.scrollTop >= breathing && viewport.scrollTop + viewport.height - target.bottom >= breathing;
  if (visible) return null;
  const desired = Math.max(0, target.top - viewport.height * ratio);
  const capped = viewport.maxScrollTop === undefined ? desired : Math.min(desired, viewport.maxScrollTop);
  return Math.abs(capped - viewport.scrollTop) <= 1 ? null : capped;
}

/** The nearest ancestor that actually scrolls (the editor's scroll column). */
export function findScrollContainer(element: HTMLElement): HTMLElement {
  let current: HTMLElement | null = element;
  while (current) {
    const overflowY = current.ownerDocument.defaultView?.getComputedStyle(current).overflowY ?? '';
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight) return current;
    current = current.parentElement;
  }
  return (element.ownerDocument.scrollingElement as HTMLElement | null) ?? element.ownerDocument.documentElement;
}

/**
 * Where the anchor of `pos` sits, as offsets relative to the scroll
 * container's scrolled content. Offset-parent arithmetic keeps the value
 * layout-stable while scrolling; bounding rectangles serve as the fallback
 * when the chain is interrupted (fixed/transformed ancestors).
 */
export function anchorOffsetsInView(view: EditorView, pos: number, container: HTMLElement): { top: number; bottom: number } | null {
  const located = view.domAtPos(pos);
  const element = located.node.nodeType === 1 ? (located.node as HTMLElement) : located.node.parentElement;
  if (!element) return null;
  let top = 0;
  let reached = false;
  for (let node: HTMLElement | null = element; node; node = node.offsetParent as HTMLElement | null) {
    if (node === container) { reached = true; break; }
    top += node.offsetTop;
  }
  if (!reached) {
    const rect = element.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    top = rect.top - containerRect.top + container.scrollTop;
    return { top, bottom: top + Math.max(rect.height, 1) };
  }
  return { top, bottom: top + Math.max(element.offsetHeight, 1) };
}

/**
 * The panel's locate action: bring the suggestion anchor into a comfortable
 * reading position of the editor's scroll column. Everything the panel needs
 * from the live DOM — scroll container, offsets, target — resolves at call
 * time, so a suggestion moved by remote edits still locates correctly. A
 * no-op (not a scroll) when the anchor is already visible; test DOMs without
 * `scrollTo` are skipped rather than crashed.
 */
export function scrollSuggestionIntoView(view: EditorView, pos: number, behavior: ScrollBehavior = 'smooth'): void {
  const located = view.domAtPos(pos);
  const element = located.node.nodeType === 1 ? (located.node as HTMLElement) : located.node.parentElement;
  if (!element) return;
  const container = findScrollContainer(element);
  const offsets = anchorOffsetsInView(view, pos, container);
  if (!offsets) return;
  const target = scrollTargetFor(
    { scrollTop: container.scrollTop, height: container.clientHeight, maxScrollTop: container.scrollHeight - container.clientHeight },
    offsets,
  );
  if (target === null || typeof container.scrollTo !== 'function') return;
  container.scrollTo({ top: target, behavior });
}

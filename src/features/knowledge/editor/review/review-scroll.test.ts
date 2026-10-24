/**
 * Long-document positioning tests (S02): the pure anchor/top-level/scroll
 * math decides in one place, and the thin DOM helpers (scroll container
 * lookup, the locate orchestration) run against a stubbed view under
 * happy-dom — geometry is injected, since happy-dom does no real layout.
 */

import 'fake-indexeddb/auto';
import { Window } from 'happy-dom';
import { beforeAll, describe, expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { EditorView } from '@tiptap/pm/view';
import { anchorOffsetsInView, findScrollContainer, scrollSuggestionIntoView, scrollTargetFor, suggestionAnchor, topLevelBlockRange } from './review-scroll';

let window: Window;

beforeAll(() => {
  window = new Window({ url: 'https://knowledge.fob.test/page' });
  (globalThis as Record<string, unknown>).window = window;
  (globalThis as Record<string, unknown>).document = window.document;
});

describe('suggestionAnchor', () => {
  test('is the uppermost range of a possibly fragmented suggestion', () => {
    expect(suggestionAnchor({ ranges: [{ from: 20 }, { from: 8 }, { from: 40 }] })).toBe(8);
    expect(suggestionAnchor({ ranges: [{ from: 3 }] })).toBe(3);
  });
});

describe('topLevelBlockRange', () => {
  const doc = knowledgeSchema.nodes.doc.create(null, [
    knowledgeSchema.nodes.paragraph.create({ blockId: 'a' }, knowledgeSchema.text('第一个块')),
    knowledgeSchema.nodes.blockquote.create({}, knowledgeSchema.nodes.paragraph.create({ blockId: 'b' }, knowledgeSchema.text('引用内'))),
    knowledgeSchema.nodes.paragraph.create({ blockId: 'c' }, knowledgeSchema.text('尾块')),
  ]);
  const state = EditorState.create({ schema: knowledgeSchema, doc });

  test('an inner position resolves to its top-level block', () => {
    // Inside the blockquote's paragraph (blockquote spans 6..13).
    expect(topLevelBlockRange(doc, 10)).toEqual({ index: 1, from: 6, to: 13 });
  });

  test('a boundary position aims at the following block; the document end at the last', () => {
    expect(topLevelBlockRange(doc, 0)).toEqual({ index: 0, from: 0, to: 6 });
    expect(topLevelBlockRange(doc, 13).index).toBe(2);
    expect(topLevelBlockRange(doc, doc.content.size)).toEqual({ index: 2, from: 13, to: 17 });
  });

  test('agrees with the state that produced the doc', () => {
    expect(topLevelBlockRange(state.doc, 2).from).toBe(0);
  });
});

describe('scrollTargetFor', () => {
  const viewport = { scrollTop: 500, height: 600, maxScrollTop: 2400 };

  test('null when the target is already comfortably visible', () => {
    expect(scrollTargetFor(viewport, { top: 520, bottom: 560 })).toBeNull();
    expect(scrollTargetFor(viewport, { top: 510, bottom: 1090 })).toBeNull();
  });

  test('lands the target at the reading ratio from the viewport top, capped at maxScrollTop', () => {
    // Below the viewport: 1900 - 600 * 0.28 = 1732.
    expect(scrollTargetFor(viewport, { top: 1900, bottom: 1930 })).toBe(1732);
    // Above the viewport: same formula from the top edge.
    expect(scrollTargetFor(viewport, { top: 100, bottom: 140 })).toBe(0);
    // Far below: capped by the maximum scroll.
    expect(scrollTargetFor(viewport, { top: 3000, bottom: 3060 })).toBe(2400);
  });

  test('returns null for a sub-pixel adjustment', () => {
    expect(scrollTargetFor({ scrollTop: 100, height: 600 }, { top: 300, bottom: 400 })).toBeNull();
  });
});

describe('DOM helpers under happy-dom', () => {
  function stubView(element: unknown): EditorView {
    return { domAtPos: () => ({ node: element, offset: 0 }) } as unknown as EditorView;
  }

  // happy-dom's element types are structurally thinner than the DOM lib's;
  // every helper below receives them cast to the interface it uses.
  const asElement = (element: unknown) => element as HTMLElement;

  /** appendChild across the two structurally-incompatible Node typings. */
  const attach = (parent: unknown, child: HTMLElement) => {
    (parent as { appendChild(node: unknown): unknown }).appendChild(child);
  };

  function sized(element: HTMLElement, values: Partial<Record<'scrollTop' | 'scrollHeight' | 'clientHeight' | 'offsetTop' | 'offsetHeight', number>>, rect?: { top: number; height: number }) {
    for (const [key, value] of Object.entries(values)) {
      Object.defineProperty(element, key, { get: () => value, configurable: true });
    }
    if (rect) {
      Object.defineProperty(element, 'getBoundingClientRect', {
        value: () => ({ top: rect.top, bottom: rect.top + rect.height, height: rect.height, width: 10, left: 0, right: 10, x: 0, y: rect.top, toJSON: () => ({}) }),
        configurable: true,
      });
    }
  }

  test('findScrollContainer prefers the nearest scrolling ancestor, then the document element', () => {
    const scroller = asElement(window.document.createElement('div'));
    scroller.style.overflowY = 'auto';
    sized(scroller, { scrollHeight: 3000, clientHeight: 600 });
    const child = asElement(window.document.createElement('span'));
    attach(scroller, child);
    attach(window.document.body, scroller);
    expect(findScrollContainer(child)).toBe(scroller);

    const plain = asElement(window.document.createElement('span'));
    attach(window.document.body, plain);
    expect(findScrollContainer(plain)).toBe(window.document.scrollingElement);
  });

  test('anchorOffsetsInView falls back to bounding rects when the offset chain is interrupted', () => {
    const container = asElement(window.document.createElement('div'));
    const element = asElement(window.document.createElement('span'));
    attach(container, element);
    attach(window.document.body, container);
    sized(element, {}, { top: 1600, height: 30 });
    sized(container, { scrollTop: 500 }, { top: 200, height: 600 });
    Object.defineProperty(element, 'offsetParent', { get: () => null, configurable: true });
    expect(anchorOffsetsInView(stubView(element), 12, container)).toEqual({ top: 1900, bottom: 1930 });
  });

  test('scrollSuggestionIntoView scrolls the column to the reading position, and is a no-op when visible', () => {
    const scroller = asElement(window.document.createElement('div'));
    scroller.style.overflowY = 'auto';
    sized(scroller, { scrollTop: 500, scrollHeight: 3000, clientHeight: 600 }, { top: 0, height: 600 });
    const element = asElement(window.document.createElement('span'));
    attach(scroller, element);
    attach(window.document.body, scroller);
    Object.defineProperty(element, 'offsetParent', { get: () => null, configurable: true });

    const calls: { top: number; behavior: string }[] = [];
    Object.defineProperty(scroller, 'scrollTo', { value: (options: { top: number; behavior: string }) => calls.push(options), configurable: true });

    // Fallback rect math: content top = 1600 (viewport) + 500 (scrollTop) = 2100;
    // the reading target is 2100 - 600 * 0.28 = 1932.
    sized(element, {}, { top: 1600, height: 30 });
    scrollSuggestionIntoView(stubView(element), 12);
    expect(calls).toEqual([{ top: 1932, behavior: 'smooth' }]);

    // Already inside the viewport window (content 500..1100): no scroll at all.
    sized(element, {}, { top: 300, height: 30 });
    scrollSuggestionIntoView(stubView(element), 12);
    expect(calls).toHaveLength(1);
  });
});

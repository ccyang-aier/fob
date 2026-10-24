import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { pdfCommentAnchorSchema } from '@fob/shared/knowledge/contracts';
import { createCommentThreadInputSchema } from '@fob/shared/knowledge/comments';
import { normalizePdfRect, mergePdfRects, readPdfSelection } from './pdf-selection';
import { deriveCommentSidebarModel } from '../comments/comments-view-model';
import { orderPdfText } from './pdf-text-order';

test('PDF selection follows visual lines even when the callout is painted after the body', () => {
  const item = (str: string, x: number, y: number) => ({ str, dir: 'ltr', width: 40, height: 12, transform: [12, 0, 0, 12, x, y], fontName: 'test', hasEOL: false });
  const content = { items: [item('Body', 20, 200), item('Heading', 20, 300), item('second', 80, 400.5), item('Callout', 20, 400)], styles: {}, lang: null };
  for (const scale of [1, 3]) {
    const ordered = orderPdfText(content, (x, y) => [x * scale, (500 - y) * scale]);
    expect(ordered.items.map(run => 'str' in run ? run.str : '')).toEqual(['Callout', 'second', 'Heading', 'Body']);
    expect(ordered.items.map(run => 'hasEOL' in run && run.hasEOL)).toEqual([false, true, true, true]);
  }
  expect(content.items[0].str).toBe('Body');
});

test('only the selected leaf text contributes geometry, never the enclosing span box', async () => {
  const browser = new Window();
  const doc = browser.document as unknown as Document;
  const host = doc.createElement('div'); doc.body.append(host);
  host.innerHTML = '<div data-pdf-page="1"><div data-pdf-text><span>First</span><span>Second</span></div></div>';
  host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 200, bottom: 400, width: 200, height: 400 } as DOMRect);
  const page = host.firstElementChild as HTMLElement; page.getBoundingClientRect = host.getBoundingClientRect;
  const nodes = [...host.querySelectorAll('span')].map(span => span.firstChild!);
  Object.defineProperty(browser.Range.prototype, 'getClientRects', { value: function(this: Range) {
    if (this.startContainer !== this.endContainer || this.startContainer.nodeType !== 3) return [{ left: 0, top: 0, right: 200, bottom: 400 }];
    const x = this.startContainer === nodes[0] ? 20 : 70;
    return [{ left: x + this.startOffset * 5, top: 40, right: x + this.endOffset * 5, bottom: 60 }];
  } });
  const range = doc.createRange(); range.setStart(nodes[0], 2); range.setEnd(nodes[1], 3); doc.getSelection()!.addRange(range);
  const selected = readPdfSelection(host, anchor.assetHash)!;
  expect(selected.anchor.quote).toBe('rstSec');
  expect(selected.anchor.pages[0].rects).toEqual([{ x: .15, y: .1, width: .075, height: .05 }, { x: .35, y: .1, width: .075, height: .05 }]);
  expect(selected.y).toBe(40);
  await browser.happyDOM.abort();
});

const anchor = { assetHash: 'a'.repeat(64), quote: 'Selected PDF text', pages: [{ page: 2, rects: [{ x: .1, y: .2, width: .3, height: .02 }] }] };
test('cross-page selection clips each range to its text layer instead of highlighting canvases', async () => {
  const browser = new Window();
  const doc = browser.document as unknown as Document;
  const host = doc.createElement('div'); doc.body.append(host);
  host.innerHTML = '<div data-pdf-page="1"><canvas></canvas><div data-pdf-text><span>First page</span></div></div><div data-pdf-page="2"><canvas></canvas><div data-pdf-text><span>Second page</span></div></div>';
  const pages = [...host.querySelectorAll<HTMLElement>('[data-pdf-page]')];
  const boxes = pages.map((_, index) => ({ left: 100, top: 100 + index * 500, right: 300, bottom: 500 + index * 500, width: 200, height: 400 }));
  pages.forEach((page, index) => { page.getBoundingClientRect = () => boxes[index] as DOMRect; });
  const pageOf = (node: Node) => (node.nodeType === 1 ? node as Element : node.parentElement)?.closest('[data-pdf-page]');
  // Browser layout reports full canvas/container boxes for an unbounded range.
  Object.defineProperty(browser.Range.prototype, 'getClientRects', { value: function(this: Range) {
    const start = pageOf(this.startContainer), end = pageOf(this.endContainer);
    if (start !== end) return boxes;
    const box = boxes[pages.indexOf(start as HTMLElement)];
    return [{ left: 120, top: box.top + 40, right: 180, bottom: box.top + 60 }];
  } });
  const range = doc.createRange();
  range.setStart(pages[0].querySelector('span')!.firstChild!, 0);
  range.setEnd(pages[1].querySelector('span')!.firstChild!, 6);
  doc.getSelection()!.addRange(range);
  const selected = readPdfSelection(host, anchor.assetHash);
  expect(selected?.anchor.pages).toEqual([1, 2].map(page => ({ page, rects: [{ x: .1, y: .1, width: .3, height: .05 }] })));
  expect(selected?.anchor.quote).toContain('First page');
  expect(selected?.y).toBe(140);
  await browser.happyDOM.abort();
});
test('PDF coordinates clip to page bounds and remain equal across zoom levels', () => {
  const normal = normalizePdfRect({ left: 120, top: 240, right: 180, bottom: 260 }, { left: 100, top: 200, right: 300, bottom: 600, width: 200, height: 400 });
  const doubled = normalizePdfRect({ left: 240, top: 480, right: 360, bottom: 520 }, { left: 200, top: 400, right: 600, bottom: 1200, width: 400, height: 800 });
  expect(normal).toEqual({ x: .1, y: .1, width: .3, height: .05 }); expect(doubled).toEqual(normal);
  expect(normalizePdfRect({ left: 20, top: 30, right: 50, bottom: 50 }, { left: 100, top: 100, right: 300, bottom: 500, width: 200, height: 400 })).toBeNull();
  expect(mergePdfRects([{ x: .1, y: .2, width: .3, height: .02 }, { x: .2, y: .2, width: .3, height: .02 }])).toEqual([{ x: .1, y: .2, width: .4, height: .02 }]);
});
test('PDF anchor contract rejects invalid geometry, duplicate pages, empty quotes and page comments with selections', () => {
  expect(pdfCommentAnchorSchema.safeParse(anchor).success).toBe(true);
  for (const invalid of [{ ...anchor, quote: '' }, { ...anchor, assetHash: 'bad' }, { ...anchor, pages: [anchor.pages[0], anchor.pages[0]] }, { ...anchor, pages: [{ page: 0, rects: anchor.pages[0].rects }] }, { ...anchor, pages: [{ page: 2, rects: [{ x: .9, y: 0, width: .2, height: .1 }] }] }]) expect(pdfCommentAnchorSchema.safeParse(invalid).success).toBe(false);
  const input = { knowledgeBaseId: crypto.randomUUID(), pageId: crypto.randomUUID(), threadId: crypto.randomUUID(), commentId: crypto.randomUUID(), kind: 'comment', anchorKind: 'page', bodyMd: 'Comment', pdfAnchor: anchor };
  expect(createCommentThreadInputSchema.safeParse(input).success).toBe(false);
  expect(createCommentThreadInputSchema.safeParse({ ...input, anchorKind: 'selection' }).success).toBe(true);
});
test('PDF sidebar orders by page and coordinates and loses location when the original asset is replaced', () => {
  const thread = { knowledgeBaseId: 'ws', pageId: 'page', id: 'one', kind: 'comment' as const, anchorKind: 'selection' as const, status: null, pdfAnchor: anchor, createdAt: '2026-10-03T00:00:00Z', updatedAt: '2026-10-03T00:00:00Z', comments: [] };
  const threads = [thread, { ...thread, id: 'two', pdfAnchor: { ...anchor, pages: [{ ...anchor.pages[0], page: 1 }] } }];
  const model = deriveCommentSidebarModel({ threads, anchors: [], excerptOf: () => '', pending: new Set(), pdfAssetHash: anchor.assetHash });
  expect(model.groups.map(group => group.threadId)).toEqual(['two', 'one']);
  expect(model.groups[0].excerpt).toBe('第 1 页 · Selected PDF text'); expect(model.unanchored).toHaveLength(0);
  expect(deriveCommentSidebarModel({ threads, anchors: [], excerptOf: () => '', pending: new Set(), pdfAssetHash: 'b'.repeat(64) }).unanchored).toHaveLength(2);
});

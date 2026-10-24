import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DocumentReferenceSurface as Surface, useDocumentReference as Reference } from './document-reference';
import type { DocumentNavigationTools as Navigation } from './document-tools';
import type { Editor } from '@tiptap/core';

let browser: Window;
let root: Root;
let DocumentReferenceSurface: typeof Surface;
let useDocumentReference: typeof Reference;
let DocumentNavigationTools: typeof Navigation;
let useDocumentNavigation: typeof import('./document-tools').useDocumentNavigation;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ DocumentReferenceSurface, useDocumentReference } = await import('./document-reference'));
  ({ DocumentNavigationTools, useDocumentNavigation } = await import('./document-tools'));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 30000);
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });
const target = {  knowledgeBaseId: 'base', pageId: 'one', source: 'server' as const };
async function click(label: string) { await act(async () => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!.click()); }

test('fixed pane keeps its real document while the primary navigates; close disposes it', async () => {
  let primaryCloses = 0;
  function Primary() {
    const reference = useDocumentReference();
    const [pageId, setPageId] = useState('one');
    const report = reference?.reportPrimaryDocument;
    useEffect(() => { report?.({ target: { ...target, pageId }, title: `Document ${pageId}` }); return () => report?.(null); }, [report, pageId]);
    return <><p data-primary-page>{pageId}</p><button aria-label="split" onClick={() => reference?.openReference?.({ target: { ...target, pageId }, title: 'Document one' })} /><button aria-label="navigate" onClick={() => setPageId('two')} /></>;
  }
  function Fixed({ pageId }: { pageId: string }) {
    const reference = useDocumentReference();
    return <><article data-live-page={pageId}>Live document content</article><button aria-label="rename" onClick={() => reference?.reportTitle?.('Renamed document')} /><p data-nested-split>{String(Boolean(reference?.openReference))}</p></>;
  }
  await act(async () => root.render(<DocumentReferenceSurface scope="test-fixed" onCloseDocument={() => { primaryCloses++; }} renderDocument={document => <Fixed pageId={document.target.pageId} />}><Primary /></DocumentReferenceSurface>));
  expect(document.querySelector('[aria-label="主栏文档标签"]')).toBeNull();
  await click('split');
  expect(document.querySelector('[aria-label="主栏文档标签"]')?.textContent).toContain('Document one');
  expect(document.querySelector('[aria-label="固定栏文档标签"]')?.textContent).toContain('Document one');
  await click('navigate');
  expect(document.querySelector('[aria-label="主栏文档标签"]')?.textContent).toContain('Document two');
  expect(document.querySelector('[aria-label="固定栏文档标签"]')?.textContent).toContain('Document one');
  await click('关闭文档标签 Document two');
  expect(primaryCloses).toBe(1);
  expect(document.querySelector('[data-live-page]')).not.toBeNull();
  expect(document.querySelector('[data-primary-page]')?.textContent).toBe('two');
  expect(document.querySelector('[data-live-page]')?.getAttribute('data-live-page')).toBe('one');
  expect(document.querySelector('iframe')).toBeNull();
  expect(document.querySelector('[data-nested-split]')?.textContent).toBe('false');
  await click('rename');
  expect(document.querySelector('[aria-label="拆分文档"]')?.textContent).toContain('Renamed document');
  const divider = document.querySelector<HTMLButtonElement>('[role="separator"]')!;
  const captured = new Set<number>();
  divider.setPointerCapture = id => { captured.add(id); };
  divider.hasPointerCapture = id => captured.has(id);
  divider.releasePointerCapture = id => { captured.delete(id); };
  await act(async () => divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0 })));
  expect(divider.dataset.resizing).toBe('true');
  await act(async () => divider.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1 })));
  expect(divider.dataset.resizing).toBeUndefined();
  expect(captured.size).toBe(0);
  await act(async () => divider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, button: 0 })));
  divider.releasePointerCapture(2);
  await act(async () => divider.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 2 })));
  expect(divider.dataset.resizing).toBeUndefined();
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('52');
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('20');
  await act(async () => divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })));
  expect(divider.getAttribute('aria-valuenow')).toBe('80');
  await click('关闭拆分视图');
  expect(document.querySelector('[data-live-page]')).toBeNull();
  expect(document.querySelector('[aria-label="主栏文档标签"]')).toBeNull();
  expect(document.querySelector('[data-primary-page]')?.textContent).toBe('two');
});

test('a resource without a document renderer cannot open a split', async () => {
  function Primary() { return <span data-can-split>{String(Boolean(useDocumentReference()?.openReference))}</span>; }
  await act(async () => root.render(<DocumentReferenceSurface scope="test-unavailable"><Primary /></DocumentReferenceSurface>));
  expect(document.querySelector('[data-can-split]')?.textContent).toBe('false');
});

test('chapter navigation leaves an explicitly expanded outline open in a compact pane', async () => {
  const { Editor } = await import('@tiptap/core');
  const { createKnowledgeExtensions } = await import('@fob/shared/knowledge/schema');
  const editor = new Editor({ extensions: createKnowledgeExtensions(), content: { type: 'doc', content: [{ type: 'heading', attrs: { level: 1, blockId: 'first' }, content: [{ type: 'text', text: 'First' }] }, { type: 'heading', attrs: { level: 2, blockId: 'second' }, content: [{ type: 'text', text: 'Second' }] }] } });
  function Header() {
    const navigation = useDocumentNavigation();
    return <button aria-label="outline" aria-expanded={navigation?.outlineOpen} onClick={navigation?.onToggleOutline} />;
  }
  await act(async () => root.render(<section aria-label="页面编辑器"><DocumentNavigationTools editor={editor as Editor} title="Test" target={target} header={<Header />}><div data-document-scroll>{editor.view.dom.outerHTML}</div></DocumentNavigationTools></section>));
  await click('outline');
  expect(document.querySelector('[aria-label="outline"]')?.getAttribute('aria-expanded')).toBe('true');
  const chapter = Array.from(document.querySelectorAll('button')).find(button => button.textContent === 'Second')!;
  await act(async () => { chapter.click(); await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(document.querySelector('[aria-label="outline"]')?.getAttribute('aria-expanded')).toBe('true');
  expect(document.querySelector('[aria-label="文档章节"]')).not.toBeNull();
  await act(async () => root.unmount());
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  editor.destroy();
});

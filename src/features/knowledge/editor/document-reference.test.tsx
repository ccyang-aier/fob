import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
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

test('document controls delegate splits and pins to the top-level workbench without nested tabs', async () => {
  const { DocumentTabContext } = await import('./document-tab-context');
  const splits: string[] = [];
  const reports: string[] = [];
  let pins = 0;
  function Primary() {
    const reference = useDocumentReference();
    const report = reference?.reportPrimaryDocument;
    useEffect(() => report?.({ target, title: 'Document one' }), [report]);
    return <><article>Live editor</article><button aria-label="split" onClick={() => reference?.openReference?.({ target, title: 'Document one' })} /><button aria-label="pin" onClick={() => reference?.togglePin({ target, title: 'Document one' })} /></>;
  }
  const value = { search: '', pinned: false, reportDocument: (document: {title:string} | null) => { if(document) reports.push(document.title); }, togglePin: () => { pins++; }, splitDocument: (document: {title:string}) => { splits.push(document.title); } };
  await act(async () => root.render(<DocumentTabContext value={value}><DocumentReferenceSurface><Primary /></DocumentReferenceSurface></DocumentTabContext>));
  await click('split'); await click('pin');
  expect(splits).toEqual(['Document one']); expect(pins).toBe(1); expect(reports).toEqual(['Document one']);
  expect(document.querySelector('[role="tablist"]')).toBeNull();
  expect(document.querySelector('[role="separator"]')).toBeNull();
  expect(document.querySelector('article')?.textContent).toBe('Live editor');
});

test('outside the workbench a document does not create its own split architecture', async () => {
  function Primary() { return <span data-can-split>{String(Boolean(useDocumentReference()?.openReference))}</span>; }
  await act(async () => root.render(<DocumentReferenceSurface><Primary /></DocumentReferenceSurface>));
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

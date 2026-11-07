import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { Window } from 'happy-dom';
import * as Y from 'yjs';
import { ySyncPluginKey } from 'y-prosemirror';
import { createKnowledgeExtensions, createBlockIdExtension } from '@fob/shared/knowledge/schema';
import { createPageUndo } from '../../collaboration/page-undo';
import { pageCollaborationExtension } from '../page-collaboration';
import { exportDocumentHtml } from '../export/document-html-export';
import { revealBlockInEditor } from '../open-target';
import { createHeadingSectionsPlugin, headingSectionsKey, toggleHeadingSection } from './heading-sections';

let browser: Window;
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'])
    globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser;
});
afterAll(async () => { await browser.happyDOM.abort(); });

function createEditor(editable = true) {
  const element = document.createElement('div'); document.body.append(element);
  const editor = new Editor({ element, editable, extensions: [...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'heading-dom-test' })], content: { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1, blockId: 'heading-1' }, content: [{ type: 'text', text: 'Heading' }] },
    { type: 'paragraph', attrs: { blockId: 'content-1' }, content: [{ type: 'text', text: 'Hidden content' }] },
    { type: 'heading', attrs: { level: 1, blockId: 'heading-2' }, content: [{ type: 'text', text: 'Next' }] },
    { type: 'paragraph', attrs: { blockId: 'content-2' }, content: [{ type: 'text', text: 'Other content' }] },
  ] } });
  editor.registerPlugin(createHeadingSectionsPlugin());
  return { editor, cleanup: () => { editor.destroy(); element.remove(); } };
}

test('readonly readers can fold without changing content; block links reveal hidden content', () => {
  const { editor, cleanup } = createEditor(false);
  try {
    const before = editor.getJSON();
    toggleHeadingSection(editor.view, 'heading-1');
    expect(editor.view.dom.querySelector('[data-heading-content-hidden]')?.textContent).toBe('Hidden content');
    expect(editor.getJSON()).toEqual(before);
    expect(revealBlockInEditor(editor.view, 'content-1')).toBe(true);
    expect(editor.view.dom.querySelector('[data-heading-content-hidden]')).toBeNull();
    expect(editor.isEditable).toBe(false);
  } finally { cleanup(); }
});

test('rendered HTML export includes folded paragraphs and restores the actual editor DOM', async () => {
  const { editor, cleanup } = createEditor();
  try {
    toggleHeadingSection(editor.view, 'heading-1');
    const html = await exportDocumentHtml(editor, 'Export');
    const output = new Window(); output.document.write(html);
    const content = [...output.document.querySelectorAll('p')].find((node) => node.textContent === 'Hidden content');
    expect(content).toBeDefined();
    expect(content?.style.display).not.toBe('none');
    expect(content?.hasAttribute('inert')).toBe(false);
    expect(editor.view.dom.querySelector('[data-heading-content-hidden]')?.textContent).toBe('Hidden content');
    expect([...headingSectionsKey.getState(editor.state)!.folded]).toEqual(['heading-1']);
    await output.happyDOM.abort();
  } finally { cleanup(); }
});

test('fold state stays local to a collaborative reader and cannot enter Yjs or shared undo', () => {
  const shared = new Y.Doc();
  const undo = createPageUndo({ document: shared, bindingOrigins: [ySyncPluginKey] });
  const editor = new Editor({ extensions: [...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'heading-fold-test' }), pageCollaborationExtension(shared, undo)] });
  try {
    editor.commands.setContent('<h1>Heading</h1><p>Body</p>');
    editor.registerPlugin(createHeadingSectionsPlugin());
    undo.local.stopCapturing();
    const snapshot = Y.encodeStateAsUpdate(shared);
    const updates: unknown[] = [];
    shared.on('update', (update) => updates.push(update));
    const id = editor.state.doc.firstChild!.attrs.blockId;
    toggleHeadingSection(editor.view, id);
    expect(updates).toEqual([]);
    expect(Y.encodeStateAsUpdate(shared)).toEqual(snapshot);
    expect([...headingSectionsKey.getState(editor.state)!.folded]).toEqual([id]);
    editor.unregisterPlugin(headingSectionsKey);
    expect(undo.undo()).toBe(true);
    expect(editor.state.doc.textContent).toBe('');
  } finally { editor.destroy(); undo.destroy(); shared.destroy(); }
});

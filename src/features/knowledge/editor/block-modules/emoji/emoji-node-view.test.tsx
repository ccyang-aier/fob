import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { Editor, Extension } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { closeHistory, history, undo } from '@tiptap/pm/history';
import { DOMParser } from '@tiptap/pm/model';
import { createKnowledgeExtensions, createBlockIdExtension, knowledgeSchema } from '@fob/shared/knowledge/schema';
import { applyEditorBlockModules } from '..';
import { buildSlashItems, filterSlashItems } from '../../commands/slash-items';
import { exportDocumentMarkdown } from '../../components/document-markdown-export';
import { exportDocumentHtml } from '../../components/document-html-export';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'KeyboardEvent',
    'DOMParser', 'MutationObserver', 'ResizeObserver', 'Range', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  ({ createRoot } = await import('react-dom/client'));
});
afterAll(async () => { await browser.happyDOM.abort(); });

test('slash emoji blocks render OpenMoji, replace values without changing identity, undo and respect read-only', async () => {
  const container = document.createElement('div');
  const host = document.createElement('div');
  container.append(host);
  document.body.append(container);
  const editor = new Editor({ element: host, extensions: [
    ...applyEditorBlockModules([...createKnowledgeExtensions(), createBlockIdExtension({ pageId: 'emoji-test' })]),
    Extension.create({ name: 'emojiTestHistory', addProseMirrorPlugins: () => [history()] }),
  ] });
  const root: Root = createRoot(container);
  try {
    await act(async () => root.render(<EditorContent editor={editor} />));
    const entry = filterSlashItems(buildSlashItems(), 'emoji')[0];
    expect(entry.name).toBe('emoji');
    await act(async () => { expect(entry.run(editor)).toBe(true); });
    const first = editor.state.doc.firstChild!;
    expect(first.type.name).toBe('emoji');
    expect(first.attrs.value).toBe('😀');
    expect(typeof first.attrs.blockId).toBe('string');
    expect(container.querySelector('[data-fob-node="emoji"] img')?.getAttribute('src')).toBe('/icons/openmoji/1F600.svg');
    await act(async () => {
      editor.view.dispatch(closeHistory(editor.state.tr));
      container.querySelector<HTMLButtonElement>('[data-fob-node="emoji"] button')!.click();
    });
    expect(document.querySelectorAll('button[data-emoji]')).toHaveLength(448);
    await act(async () => document.querySelector<HTMLButtonElement>('button[data-emoji="🚀"]')!.click());
    expect(editor.state.doc.firstChild?.attrs.value).toBe('🚀');
    expect(editor.state.doc.firstChild?.attrs.blockId).toBe(first.attrs.blockId);
    expect(exportDocumentMarkdown(editor.state.doc, '标题')).toContain('🚀');
    const html = document.createElement('div');
    html.innerHTML = editor.getHTML();
    expect(DOMParser.fromSchema(knowledgeSchema).parse(html).firstChild?.attrs.value).toBe('🚀');
    const originalFetch = globalThis.fetch;
    try {
      globalThis.fetch = (async () => ({ ok: true, blob: async () => new browser.Blob(['emoji'], { type: 'image/svg+xml' }) })) as unknown as typeof fetch;
      const exported = await exportDocumentHtml(editor, '标题');
      expect(exported).toContain('data:image/svg+xml;base64,');
      const frozen = new browser.DOMParser().parseFromString(exported, 'text/html');
      expect(frozen.querySelector('[data-emoji-block] img')).not.toBeNull();
      expect(frozen.querySelector('button')).toBeNull();
    } finally { globalThis.fetch = originalFetch; }
    await act(async () => { undo(editor.state, editor.view.dispatch); });
    expect(editor.state.doc.firstChild?.attrs.value).toBe('😀');
    await act(async () => editor.setEditable(false));
    expect(container.querySelector('[data-fob-node="emoji"] button')).toBeNull();
    expect(container.querySelector('[data-fob-node="emoji"] [role="img"]')?.getAttribute('aria-label')).toBe('😀');
  } finally {
    await act(async () => root.unmount());
    editor.destroy(); container.remove();
  }
});

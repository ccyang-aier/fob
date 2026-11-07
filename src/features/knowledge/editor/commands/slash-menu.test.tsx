import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { PageVisibility } from '@/lib/page-visibility';
import { createSlashPasteExtensions } from './slash-paste';
import { SlashMenuLayer } from './slash-menu';

let browser: Window;
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'DOMParser']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
});
afterAll(async () => { await browser.happyDOM.abort(); });

test('retained editor tabs cannot duplicate the visible insertion menu', async () => {
  const editors = [0, 1].map(() => {
    const editor = new Editor({ extensions: [...createKnowledgeExtensions(), ...createSlashPasteExtensions()] });
    editor.view.coordsAtPos = () => ({ left: 100, right: 100, top: 100, bottom: 120 });
    editor.commands.insertContent('/');
    return editor;
  });
  const host = document.createElement('div'); document.body.append(host);
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(host);
  const render = (active: number) => act(async () => root.render(<>{editors.map((editor, index) => <PageVisibility key={index} value={active === index}><SlashMenuLayer editor={editor} /></PageVisibility>)}</>));
  try {
    await render(0);
    expect(document.querySelectorAll('[role=menu][aria-label="插入块"]')).toHaveLength(1);
    await render(1);
    expect(document.querySelectorAll('[role=menu][aria-label="插入块"]')).toHaveLength(1);
    await render(-1);
    expect(document.querySelector('[role=menu][aria-label="插入块"]')).toBeNull();
    expect(editors.map(editor => editor.state.doc.textContent)).toEqual(['/', '/']);
  } finally { await act(async () => root.unmount()); editors.forEach(editor => editor.destroy()); host.remove(); }
});

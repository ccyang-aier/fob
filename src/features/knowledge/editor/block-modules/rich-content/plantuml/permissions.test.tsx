import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { Editor } from '@tiptap/core';
import { EditorContent } from '@tiptap/react';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
let applyModules: (typeof import('../..'))['applyEditorBlockModules'];
const previous = new Map<string, PropertyDescriptor | undefined>();
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  browser.document.write('<!doctype html><html><head></head><body></body></html>');
  const globals = globalThis as Record<string, unknown>;
  const values = browser as unknown as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text', 'Event', 'MouseEvent', 'KeyboardEvent', 'PointerEvent', 'HTMLInputElement', 'HTMLButtonElement', 'DocumentFragment', 'CustomEvent', 'FocusEvent', 'DOMParser', 'MutationObserver', 'ResizeObserver', 'Range', 'getComputedStyle', 'window', 'IS_REACT_ACT_ENVIRONMENT', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    globals[name] = name === 'window' ? browser : name === 'IS_REACT_ACT_ENVIRONMENT' ? true
      : name === 'requestAnimationFrame' ? browser.requestAnimationFrame.bind(browser)
      : name === 'cancelAnimationFrame' ? browser.cancelAnimationFrame.bind(browser) : values[name];
  }
  ({ createRoot } = await import('react-dom/client'));
  ({ applyEditorBlockModules: applyModules } = await import('../..'));
});
afterAll(async () => {
  await browser.happyDOM.abort();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

test('revoking edit permission closes PlantUML source editing and removes mutation controls without rewriting the block', async () => {
  const source = '@startuml\nAlice -> Bob : Hello\n@enduml';
  const container = document.createElement('div'), host = document.createElement('div');
  container.append(host); document.body.append(container);
  const editor = new Editor({ element: host, extensions: applyModules(createKnowledgeExtensions()), content: {
    type: 'doc', content: [{ type: 'plantuml', attrs: { blockId: 'plantuml-permission', title: 'Collaboration', source } }],
  } });
  const root = createRoot(container);
  try {
    await act(async () => root.render(<EditorContent editor={editor} />));
    const block = container.querySelector('[data-fob-node="plantuml"]')!;
    const edit = [...block.querySelectorAll('button')].find(button => /编辑图表|Edit diagram/.test(button.getAttribute('aria-label') || ''))!;
    await act(async () => edit.click());
    expect(block.querySelector('textarea')?.value).toBe(source);
    const before = JSON.stringify(editor.getJSON());
    await act(async () => editor.setEditable(false));
    expect(block.querySelector('textarea')).toBeNull();
    expect(block.querySelectorAll('[data-graphic-resize]')).toHaveLength(0);
    expect([...block.querySelectorAll('button')].some(button => /编辑|Edit|预览$|^Preview$/.test(button.getAttribute('aria-label') || ''))).toBe(false);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  } finally {
    await act(async () => root.unmount());
    editor.destroy(); container.remove();
  }
});

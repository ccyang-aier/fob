import { beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { HeadingAffordance } from './heading-affordance';

beforeAll(() => {
  const window = new Window();
  const globals = window as unknown as Record<string, unknown>;
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'Range', 'getSelection', 'HTMLElement', 'Element', 'Node', 'Text', 'Comment', 'customElements', 'requestAnimationFrame']) {
    if (globals[key] !== undefined) (globalThis as Record<string, unknown>)[key] = globals[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

test('caret markers follow a heading without changing document attributes or content', () => {
  const editor = new Editor({ extensions: [...createKnowledgeExtensions(), HeadingAffordance], content: '<h1>Heading</h1><p>Body</p>' });
  const initial = editor.getJSON();
  editor.commands.setTextSelection(2);
  expect(editor.view.dom.querySelector('h1')?.hasAttribute('data-heading-current')).toBe(true);
  editor.commands.setTextSelection({ from: 1, to: 5 });
  expect(editor.view.dom.querySelector('h1')?.hasAttribute('data-heading-current')).toBe(false);
  editor.commands.setTextSelection(editor.state.doc.firstChild!.nodeSize + 1);
  expect(editor.view.dom.querySelector('h1')?.hasAttribute('data-heading-current')).toBe(false);
  expect(editor.getJSON()).toEqual(initial);
  editor.destroy();
});

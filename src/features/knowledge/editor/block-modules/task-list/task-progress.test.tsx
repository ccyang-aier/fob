import { afterAll, beforeAll, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createDomEnvironment } from '@/test/dom-environment';

let environment: ReturnType<typeof createDomEnvironment>;
let root: Root, editor: Editor, host: HTMLDivElement;
let Progress: (typeof import('./task-progress'))['TaskProgress'];

beforeAll(async () => {
  environment = createDomEnvironment();
  ({ TaskProgress: Progress } = await import('./task-progress'));
  editor = new Editor({ extensions: createKnowledgeExtensions(), content: { type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
    { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
  ] }] } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  await act(async () => root.render(<><section><Progress editor={editor} /></section><section><Progress editor={editor} /></section></>));
});
afterAll(async () => {
  await act(async () => root.unmount());
  if (!editor.isDestroyed) editor.destroy();
  await environment.cleanup();
});

test('duplicate views remain accurate through selection, remote-style edits, restore and editor removal', async () => {
  const labels = () => [...host.querySelectorAll('section')].map(section => section.textContent);
  const initial = labels();
  expect(initial[0]).toContain('1'); expect(initial[1]).toBe(initial[0]);
  const previous = editor.state.doc;
  await act(async () => { editor.view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, 3))); });
  expect(labels()).toEqual(initial);
  await act(async () => { editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { ...editor.state.doc.nodeAt(1)!.attrs, checked: true }).setMeta('origin', 'remote')); });
  expect(labels().every(label => label?.includes('2'))).toBe(true);
  await act(async () => { editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, previous.content)); });
  expect(labels()).toEqual(initial);
  await act(async () => root.render(<section><Progress editor={null} /></section>));
  expect(labels().every(label => label?.includes('0'))).toBe(true);
});

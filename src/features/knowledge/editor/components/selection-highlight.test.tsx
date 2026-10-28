import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';
import { Editor, Extension } from '@tiptap/core';
import { history, undo } from '@tiptap/pm/history';
import { DOMParser } from '@tiptap/pm/model';
import { createKnowledgeExtensions, knowledgeSchema } from '@fob/shared/knowledge/schema';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { SelectionHighlight } from './selection-highlight';

let browser: Window;
let root: Root;
let editor: Editor;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
beforeAll(async () => {
  browser = new Window();
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'Event', 'MouseEvent',
    'KeyboardEvent', 'MutationObserver', 'ResizeObserver', 'Range', 'getComputedStyle']) {
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  }
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  ({ createRoot } = await import('react-dom/client'));
});
afterEach(async () => {
  await act(async () => root?.unmount());
  editor?.destroy();
  document.body.replaceChildren();
});
afterAll(async () => { await browser.happyDOM.abort(); });

async function mount() {
  const host = document.createElement('div');
  const tools = document.createElement('div');
  document.body.append(host, tools);
  editor = new Editor({ element: host, content: '<p>前面选择文字后面</p>', extensions: [
    ...createKnowledgeExtensions(), Extension.create({ name: 'testHistory', addProseMirrorPlugins: () => [history()] }),
  ] });
  editor.commands.setTextSelection({ from: 3, to: 7 });
  root = createRoot(tools);
  await act(async () => root.render(<SelectionHighlight editor={editor} onOpenChange={() => {}} />));
  return tools.querySelector<HTMLButtonElement>('button')!;
}
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  await act(async () => button.click());
}

test('hover opens pastel choices without changing content; applying affects only the selection and can undo', async () => {
  const trigger = await mount();
  const before = editor.state.doc;
  await act(async () => trigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
  expect(document.querySelector('[role="dialog"][aria-label="高亮颜色"]')).not.toBeNull();
  expect(document.querySelectorAll('[aria-label="预置高亮颜色"] button')).toHaveLength(6);
  expect(editor.state.doc.eq(before)).toBe(true);
  await click('浅粉色');
  expect(editor.state.doc.textContent).toBe('前面选择文字后面');
  expect(editor.getHTML()).toContain('data-color="#fbe0ec"');
  expect(editor.view.dom.querySelector('mark')?.textContent).toBe('选择文字');
  expect(editor.view.dom.querySelector('mark')?.style.backgroundColor).toBe('#fbe0ec');
  expect(document.querySelector('[data-selection-highlight]')).toBeNull();
  undo(editor.state, editor.view.dispatch);
  expect(editor.state.doc.eq(before)).toBe(true);
});

test('custom hex and alpha survive HTML and Markdown; clearing removes the mark', async () => {
  await mount();
  await click('高亮');
  await click('自定义颜色');
  const hex = document.querySelector<HTMLInputElement>('[aria-label="十六进制颜色"]')!;
  expect(hex).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(hex, '#bfe7db80');
    hex.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(editor.getHTML()).not.toContain('<mark');
  await click('应用');
  expect(editor.getHTML()).toContain('data-color="#bfe7db80"');
  const copy = document.createElement('div');
  copy.innerHTML = editor.getHTML();
  const pasted = DOMParser.fromSchema(knowledgeSchema).parse(copy);
  const colors: string[] = [];
  pasted.descendants(node => { node.marks.forEach(mark => { if (mark.type.name === 'highlight') colors.push(mark.attrs.color); }); });
  expect(colors).toEqual(['#bfe7db80']);
  const markdown = createMarkdownPipeline();
  const serialized = markdown.serialize(editor.state.doc);
  expect(markdown.parse(serialized).toJSON()).toEqual(editor.state.doc.toJSON());
  await click('高亮');
  await click('移除高亮');
  expect(editor.getHTML()).not.toContain('<mark');
});

test('Escape closes the palette and does not apply the custom draft', async () => {
  const trigger = await mount();
  const before = editor.state.doc;
  await act(async () => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  expect(document.querySelector('[data-selection-highlight]')).not.toBeNull();
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[data-selection-highlight]')).toBeNull();
  expect(editor.state.doc.eq(before)).toBe(true);
});

test('legacy named highlight colors can open the custom picker safely', async () => {
  await mount();
  editor.commands.setMark('highlight', { color: 'yellow' });
  await click('高亮');
  await click('自定义颜色');
  expect(document.querySelector<HTMLInputElement>('[aria-label="十六进制颜色"]')?.value).toBe('#fff2b3');
  expect(editor.getAttributes('highlight').color).toBe('yellow');
});

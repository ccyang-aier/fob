import { beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createTaskCelebration } from './task-celebration';
import { TaskItemToggle } from './task-item-toggle';

let window: Window;
let finish: Array<() => void> = [];
beforeAll(() => {
  window = new Window();
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'Text', 'getSelection', 'requestAnimationFrame']) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }
  (globalThis as Record<string, unknown>).window = window;
  Object.defineProperty(window.HTMLElement.prototype, 'animate', { value: () => {
    let complete!: () => void;
    const finished = new Promise<void>(resolve => { complete = resolve; });
    finish.push(complete);
    return { finished, cancel: complete };
  } });
});

test('celebrations stay outside the editor and clean up after completion and disposal', async () => {
  const effect = createTaskCelebration(window.document as unknown as Document);
  finish = [];
  effect.burst(10, 20);
  expect(window.document.querySelectorAll('[data-task-celebration]')).toHaveLength(1);
  expect(finish).toHaveLength(40);
  for (const complete of finish) complete();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(window.document.querySelectorAll('[data-task-celebration]')).toHaveLength(0);
  effect.burst(10, 20);
  effect.burst(30, 40);
  effect.destroy();
  expect(window.document.querySelectorAll('[data-task-celebration]')).toHaveLength(0);
});

test('celebrations retain the full effect regardless of system motion preference', () => {
  const reducedWindow = new Window({ settings: { device: { prefersReducedMotion: 'reduce' } } });
  Object.defineProperty(reducedWindow.HTMLElement.prototype, 'animate', Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'animate')!);
  finish = [];
  const effect = createTaskCelebration(reducedWindow.document as unknown as Document);
  effect.burst(10, 20);
  expect(reducedWindow.document.querySelectorAll('[data-task-celebration]')).toHaveLength(1);
  expect(finish).toHaveLength(40);
  effect.destroy();
  expect(reducedWindow.document.querySelector('[data-task-celebration]')).toBeNull();
});

test('only checking a local editable marker celebrates; state updates and unchecking do not', () => {
  const host = window.document.createElement('div');
  window.document.body.append(host);
  const editor = new Editor({ element: host as unknown as HTMLElement, extensions: [...createKnowledgeExtensions(), TaskItemToggle], content: '<ul data-task-list><li data-task-item data-checked="false"><p>完成任务</p></li></ul>' });
  const click = (x: number) => {
    const item = editor.view.dom.querySelector('li')!;
    item.style.fontSize = '16px';
    const event = new window.MouseEvent('click', { clientX: x, clientY: 12, bubbles: true, cancelable: true });
    item.dispatchEvent(event as unknown as Event);
    return editor.view.someProp('handleClickOn', handler => handler(editor.view, 2, editor.state.doc.child(0).child(0), 1, event as unknown as MouseEvent, true));
  };
  try {
    editor.view.dispatch(editor.state.tr.setNodeMarkup(1, undefined, { checked: true }));
    expect(editor.state.doc.child(0).child(0).attrs.checked).toBe(true);
    expect(window.document.querySelector('[data-task-celebration]')).toBeNull();
    editor.commands.setContent('<ul data-task-list><li data-task-item data-checked="false"><p>完成任务</p></li></ul>');
    click(50);
    expect(editor.state.doc.child(0).child(0).attrs.checked).toBe(false);
    expect(click(10)).toBe(true);
    expect(editor.state.doc.child(0).child(0).attrs.checked).toBe(true);
    expect(editor.view.dom.querySelector('[data-task-celebration]')).toBeNull();
    expect(window.document.querySelectorAll('[data-task-celebration]')).toHaveLength(1);
    expect(click(10)).toBe(true);
    expect(editor.state.doc.child(0).child(0).attrs.checked).toBe(false);
    expect(window.document.querySelectorAll('[data-task-celebration]')).toHaveLength(1);
    editor.setEditable(false);
    click(10);
    expect(editor.state.doc.child(0).child(0).attrs.checked).toBe(false);
  } finally {
    editor.destroy();
    host.remove();
  }
  expect(window.document.querySelector('[data-task-celebration]')).toBeNull();
});

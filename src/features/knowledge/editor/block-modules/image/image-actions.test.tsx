import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { act, createElement, type ImgHTMLAttributes } from 'react';
import { Window } from 'happy-dom';
import { Editor, Extension } from '@tiptap/core';
import { closeHistory, history, undo } from '@tiptap/pm/history';
import { EditorContent } from '@tiptap/react';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';

let browser: Window;
let createRoot: (typeof import('react-dom/client'))['createRoot'];
let applyModules: (typeof import('..'))['applyEditorBlockModules'];
let TooltipProvider: (typeof import('@/components/ui/tooltip'))['TooltipProvider'];
const saved: { base: string; name: string }[] = [];
const replacement = 'asset:' + 'a'.repeat(64);
mock.module('../../../assets/local-assets', () => ({
  saveLocalAsset: async (base: string, file: File) => { saved.push({ base, name: file.name }); return replacement; },
  readLocalAsset: async () => ({ blob: new Blob(['png'], { type: 'image/png' }), name: 'replacement.png', mime: 'image/png', size: 3 }),
}));
mock.module('next/image', () => ({ default: ({ unoptimized, ...props }: ImgHTMLAttributes<HTMLImageElement> & { unoptimized?: boolean }) => { void unoptimized; return createElement('img', props); } }));
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
  ({ applyEditorBlockModules: applyModules } = await import('..'));
  ({ TooltipProvider } = await import('@/components/ui/tooltip'));
});
afterAll(async () => {
  await browser.happyDOM.abort();
  for (const [name, descriptor] of previous) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete (globalThis as Record<string, unknown>)[name];
  }
});

async function mountImage() {
  const container = document.createElement('div'), host = document.createElement('div');
  container.append(host); document.body.append(container);
  const editor = new Editor({ element: host, extensions: [...applyModules(createKnowledgeExtensions(), { localKnowledgeBaseId: 'image-actions-test' }),
    Extension.create({ name: 'imageLayoutHistory', addProseMirrorPlugins: () => [history()] })], content: {
    type: 'doc', content: [{ type: 'image', attrs: { src: 'https://images.example/original.png', title: 'Original image', alt: 'Original alt', caption: 'Keep this caption', blockId: 'keep-image-id' } }],
  } });
  const root = createRoot(container);
  await act(async () => root.render(<TooltipProvider><EditorContent editor={editor} /></TooltipProvider>));
  const block = container.querySelector<HTMLElement>('[data-fob-node="image"]')!;
  const button = (label: RegExp) => [...block.querySelectorAll<HTMLButtonElement>('button')].find(element => label.test(element.getAttribute('aria-label') ?? ''));
  const select = async () => {
    const input = block.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, 'files', { configurable: true, value: [new browser.File(['png'], 'replacement.png', { type: 'image/png' })] });
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); });
  };
  return { editor, block, button, select, dispose: async () => { await act(async () => root.unmount()); editor.destroy(); container.remove(); } };
}

test('image actions open the current image in a modal and replace it in place, preserving block identity and caption', async () => {
  const fixture = await mountImage();
  const { editor, block, button } = fixture;
  try {
    const before = JSON.stringify(editor.getJSON());
    const enlarge = button(/^放大$|^Enlarge$/)!;
    await act(async () => { enlarge.focus(); enlarge.click(); });
    const dialog = document.querySelector<HTMLDialogElement>('[data-graphic-viewer]')!;
    expect(dialog.open).toBe(true);
    expect(dialog.dataset.presentation).toBe('image');
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://images.example/original.png');
    expect(block.querySelector('a[target="_blank"]')).toBeNull();
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    const preview = dialog.querySelector<HTMLImageElement>('img')!;
    preview.getBoundingClientRect = () => new browser.DOMRect(100, 100, 200, 100) as DOMRect;
    await act(async () => dialog.querySelector('[data-graphic-viewport]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 10, clientY: 10 })));
    expect(document.querySelector('[data-graphic-viewer]')).toBeNull();
    expect(document.activeElement === enlarge).toBe(true);
    let picked = 0;
    block.querySelector<HTMLInputElement>('input[type="file"]')!.click = () => { picked++; };
    await act(async () => button(/^替换$|^Replace$/)!.click());
    expect(picked).toBe(1);
    expect(JSON.stringify(editor.getJSON())).toBe(before); // Canceling a chooser leaves the image intact.
    await fixture.select();
    expect(saved.at(-1)).toEqual({ base: 'image-actions-test', name: 'replacement.png' });
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ src: replacement, title: 'replacement.png', alt: 'replacement.png', blockId: 'keep-image-id', caption: 'Keep this caption' });
    expect(block.querySelector('img')?.getAttribute('src')?.startsWith('blob:')).toBe(true);
  } finally { await fixture.dispose(); }
});

test('read-only images keep enlargement and reject replacement if permission changes while choosing a file', async () => {
  const fixture = await mountImage();
  const { editor, button } = fixture;
  try {
    const before = JSON.stringify(editor.getJSON()), previousSaved = saved.length;
    await act(async () => editor.setEditable(false));
    expect(button(/^替换$|^Replace$/)).toBeUndefined();
    expect(button(/^排布$|^Arrange$/)).toBeUndefined();
    expect(fixture.block.querySelector('[data-graphic-resize]')).toBeNull();
    await fixture.select();
    expect(saved.length).toBe(previousSaved);
    await act(async () => button(/^放大$|^Enlarge$/)!.click());
    expect(document.querySelector<HTMLDialogElement>('[data-graphic-viewer]')?.open).toBe(true);
    expect(JSON.stringify(editor.getJSON())).toBe(before);
  } finally { await fixture.dispose(); }
});

test('image resizing previews proportionally, commits once, undoes and cancels on capture or permission loss', async () => {
  const fixture = await mountImage();
  const { editor, block } = fixture;
  try {
    const surface = block.querySelector<HTMLElement>('[data-image-surface]')!;
    Object.defineProperty(surface.parentElement!, 'clientWidth', { configurable: true, value: 1000 });
    Object.defineProperties(surface, { offsetWidth: { configurable: true, get: () => surface.dataset.graphicAutoWidth === 'true' ? 200 : parseFloat(surface.style.width) * 10 }, offsetHeight: { configurable: true, get: () => surface.offsetWidth / 2 } });
    surface.getBoundingClientRect = () => new browser.DOMRect(0, 0, surface.offsetWidth, surface.offsetHeight) as DOMRect;
    const handle = surface.querySelector<HTMLButtonElement>('[data-graphic-resize="x"]')!;
    let captured = false;
    handle.setPointerCapture = () => { captured = true; }; handle.hasPointerCapture = () => captured; handle.releasePointerCapture = () => { captured = false; };
    const pointer = (type: string, x: number) => act(async () => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, button: 0, clientX: x, clientY: 100 })));
    const before = JSON.stringify(editor.getJSON());
    await act(async () => editor.view.dispatch(closeHistory(editor.state.tr)));
    await pointer('pointerdown', 200); await pointer('pointermove', 250);
    expect(surface.style.width).toBe('30%'); // Center anchoring follows the dragged edge at half the width delta.
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    await pointer('pointerup', 250);
    expect(editor.state.doc.firstChild?.attrs).toMatchObject({ width: 30, autoWidth: false, align: 'center', blockId: 'keep-image-id', caption: 'Keep this caption' });
    await act(async () => { expect(undo(editor.state, editor.view.dispatch)).toBe(true); });
    expect(JSON.stringify(editor.getJSON())).toBe(before);
    for (const end of ['pointercancel', 'lostpointercapture']) {
      await pointer('pointerdown', 200); await pointer('pointermove', 250); await pointer(end, 250);
      expect(surface.style.width).toBe(''); expect(JSON.stringify(editor.getJSON())).toBe(before);
    }
    await pointer('pointerdown', 200); await pointer('pointermove', 250);
    await act(async () => editor.setEditable(false));
    expect(surface.style.width).toBe(''); expect(JSON.stringify(editor.getJSON())).toBe(before);
  } finally { await fixture.dispose(); }
});

test('the image arrangement menu saves left, center and right while retaining source and width', async () => {
  const fixture = await mountImage();
  const { editor, block, button } = fixture;
  try {
    for (const [name, align] of [['靠左', 'left'], ['靠右', 'right'], ['居中', 'center']]) {
      await act(async () => button(/^排布$|^Arrange$/)!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
      const item = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(item => item.textContent === name)!;
      expect(Boolean(item)).toBe(true);
      await act(async () => item.click());
      expect(editor.state.doc.firstChild?.attrs).toMatchObject({ align, src: 'https://images.example/original.png', blockId: 'keep-image-id', width: 100 });
      expect(block.dataset.blockAlign).toBe(align);
    }
  } finally { await fixture.dispose(); }
});

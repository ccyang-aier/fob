import { beforeAll, describe, expect, test } from 'bun:test';
import { Window, type HTMLInputElement } from 'happy-dom';
import { Editor } from '@tiptap/core';
import { createBlockIdExtension, createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { insertMedia, takeInsertedMedia } from './insert-media';

let window: Window;
beforeAll(() => {
  window = new Window();
  for (const key of ['document', 'DOMParser', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'getSelection', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    (globalThis as Record<string, unknown>)[key] = (window as unknown as Record<string, unknown>)[key];
  }
  (globalThis as Record<string, unknown>).window = window;
});

describe('direct media picker', () => {
  for (const kind of ['image', 'video', 'audio'] as const) {
    test(`${kind}: selection opens first, cancellation inserts nothing, chosen file is consumed once`, () => {
      const editor = new Editor({ extensions: [...createKnowledgeExtensions(), createBlockIdExtension({ pageId: '00000000-0000-4000-8000-000000000001' })] });
      try {
        const original = editor.getJSON();
        expect(insertMedia(kind)(editor)).toBe(true);
        let input = window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
        expect(input.accept).toBe(kind + '/*');
        expect(editor.getJSON()).toEqual(original);
        input.dispatchEvent(new window.Event('cancel'));
        expect(window.document.querySelector('input[type="file"]')).toBeNull();
        expect(editor.getJSON()).toEqual(original);
        insertMedia(kind)(editor);
        input = window.document.querySelector<HTMLInputElement>('input[type="file"]')!;
        const file = new window.File(['fixture'], 'sample', { type: kind + '/test' }) as unknown as File;
        Object.defineProperty(input, 'files', { value: [file] });
        input.dispatchEvent(new window.Event('change'));
        const block = editor.state.doc.content.content.find(node => node.type.name === kind)!;
        expect(block).toBeDefined();
        expect(takeInsertedMedia(block.attrs.blockId)).toBe(file);
        expect(takeInsertedMedia(block.attrs.blockId)).toBeUndefined();
        expect(window.document.querySelector('input[type="file"]')).toBeNull();
        editor.setEditable(false);
        expect(insertMedia(kind)(editor)).toBe(false);
      } finally { editor.destroy(); }
    });
  }
});

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Editor } from '@tiptap/core';
import { createKnowledgeExtensions } from '@fob/shared/knowledge/schema';
import { createDomEnvironment } from '@/test/dom-environment';
import { takeInsertedMedia } from '../block-modules/media-core/insert-media';
import { insertDocumentFiles } from './insert-files';

let environment: ReturnType<typeof createDomEnvironment>;
beforeAll(() => { environment = createDomEnvironment(); });
afterAll(async () => { await environment.cleanup(); });
const errors = { unavailable: 'unavailable', unsupported: 'unsupported', tooLarge: 'too large' };
function createEditor() {
  const editor = new Editor({ element: document.createElement('div'), extensions: createKnowledgeExtensions(), content: { type: 'doc', content: [{ type: 'paragraph', attrs: { blockId: 'original' }, content: [{ type: 'text', text: 'Keep before and after' }] }] } });
  editor.commands.setTextSelection(12);
  return editor;
}

test('Markdown and plain text insert into the active document without replacing existing content', async () => {
  const editor = createEditor();
  try {
    await insertDocumentFiles(editor, [new File(['# Imported heading\n\n**Editable** content'], 'sample.md'), new File(['# Plain text\nSecond line'], 'sample.txt')], errors);
    expect(editor.getText()).toContain('Keep before');
    expect(editor.getText()).toContain('and after');
    expect(editor.getText()).toContain('Imported heading');
    expect(editor.getText()).toContain('# Plain text');
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"heading"');
    expect(JSON.stringify(editor.getJSON())).toContain('"type":"bold"');
    expect(editor.state.doc.firstChild?.attrs.blockId).toBe('original');
  } finally { editor.destroy(); }
});

test('invalid batches and oversized text leave the current document unchanged', async () => {
  const editor = createEditor(), before = editor.getJSON();
  try {
    await expect(insertDocumentFiles(editor, [new File(['ok'], 'valid.md'), new File(['bad'], 'unknown.exe')], errors)).rejects.toThrow('unsupported');
    expect(editor.getJSON()).toEqual(before);
    await expect(insertDocumentFiles(editor, [new File(['a'.repeat(1024 * 1024 + 1)], 'too-large.txt')], errors)).rejects.toThrow('too large');
    expect(editor.getJSON()).toEqual(before);
  } finally { editor.destroy(); }
});

test('permission revocation during file reading prevents insertion', async () => {
  const editor = createEditor(), before = editor.getJSON(), file = new File(['content'], 'sample.txt');
  let finish!: (buffer: ArrayBuffer) => void;
  Object.defineProperty(file, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { finish = resolve; }) });
  try {
    const importing = insertDocumentFiles(editor, [file], errors);
    editor.setEditable(false);
    finish(new TextEncoder().encode('content').buffer as ArrayBuffer);
    await expect(importing).rejects.toThrow('unavailable');
    expect(editor.getJSON()).toEqual(before);
  } finally { editor.destroy(); }
});

test('binary files become editor blocks that reuse the existing asset upload handoff', async () => {
  const editor = createEditor(), file = new File(['%PDF'], 'source.pdf', { type: 'application/pdf' });
  try {
    await insertDocumentFiles(editor, [file], errors);
    let found = false;
    editor.state.doc.descendants(node => { if (node.type.name === 'pdf') { found = true; expect(takeInsertedMedia(node.attrs.blockId)).toBe(file); } });
    expect(found).toBe(true);
    expect(editor.getText()).toContain('Keep before');
  } finally { editor.destroy(); }
});

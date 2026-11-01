import type { Editor } from '@tiptap/core';
import { MAX_TEXT_IMPORT_BYTES, parseTextDocument, textDocumentFormat } from '@fob/shared/knowledge/text-import';
import { decodeDocumentText, documentFileFormat } from '../../documents/previews/file-format';
import { rememberInsertedMedia, takeInsertedMedia } from '../block-modules/media-core/insert-media';

/** One document transaction; imported files never create or navigate to another page. */
export async function insertDocumentFiles(editor: Editor, files: readonly File[], messages: { unavailable: string; unsupported: string; tooLarge: string }, signal?: AbortSignal) {
  const writable = () => {
    signal?.throwIfAborted();
    if (editor.isDestroyed || !editor.isEditable) throw new Error(messages.unavailable);
  };
  writable();
  const prepared = await Promise.all(files.map(async file => {
    const format = documentFileFormat(file.name), text = textDocumentFormat(file.name);
    if (!format) throw new Error(messages.unsupported);
    if (file.size > (text ? MAX_TEXT_IMPORT_BYTES : 100 * 1024 * 1024)) throw new Error(messages.tooLarge);
    if (text) return { nodes: [...parseTextDocument(await decodeDocumentText(file), text).content.content] };
    const blockId = crypto.randomUUID(), kind = format === 'pdf' ? 'pdf' : format === 'image' ? 'image' : 'file';
    return { nodes: [editor.schema.nodes[kind].create({ blockId, title: file.name, mime: file.type || null, size: file.size })], file, blockId };
  }));
  writable();
  const staged = prepared.filter(item => item.file && item.blockId);
  for (const item of staged) rememberInsertedMedia(item.blockId!, item.file!);
  let inserted = false;
  try {
    const nodes = prepared.flatMap(item => item.nodes.map(node => node.toJSON()));
    inserted = nodes.length > 0 && editor.commands.insertContent(nodes);
    if (!inserted) throw new Error(messages.unavailable);
  } finally {
    if (!inserted) for (const item of staged) takeInsertedMedia(item.blockId!);
  }
}

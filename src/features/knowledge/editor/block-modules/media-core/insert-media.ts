import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './insert-media.messages';

import type { BlockInsertCommand } from '../types';
import { insertBlockNodes } from '../insert';

const knowledgeT = createTranslator(knowledgeMessages);

type PickableMedia = 'image' | 'video' | 'audio';
const selectedFiles = new Map<string, File>();
export function takeInsertedMedia(blockId: string): File | undefined {
  const file = selectedFiles.get(blockId);
  selectedFiles.delete(blockId);
  return file;
}

/** Open from the user's insertion gesture; cancellation leaves no empty block. */
export function insertMedia(kind: PickableMedia): BlockInsertCommand {
  return (editor) => {
    if (!editor.isEditable) return false;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = kind + '/*';
    input.hidden = true;
    input.setAttribute(
      'aria-label',
      knowledgeT('choose') +
        { image: knowledgeT('image'), video: knowledgeT('video'), audio: knowledgeT('audio') }[
          kind
        ] +
        knowledgeT('file'),
    );
    input.addEventListener('cancel', () => input.remove(), { once: true });
    input.addEventListener(
      'change',
      () => {
        const file = input.files?.[0];
        if (file && !editor.isDestroyed) {
          const blockId = crypto.randomUUID();
          selectedFiles.set(blockId, file);
          if (!insertBlockNodes([editor.schema.nodes[kind].create({ blockId })])(editor))
            selectedFiles.delete(blockId);
        }
        input.remove();
      },
      { once: true },
    );
    document.body.append(input);
    input.click();
    return true;
  };
}

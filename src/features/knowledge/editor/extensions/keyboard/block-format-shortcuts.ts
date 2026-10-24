import { Extension } from '@tiptap/core';
import { setBlockFormat } from '../format/block-format';

/** Shortcuts shown in the slash menu; the same format commands serve mouse and keyboard. */
export const BlockFormatShortcuts = Extension.create({
  name: 'fobBlockFormatShortcuts',
  addKeyboardShortcuts() {
    const heading = (level: number) => () => this.editor.chain().command(setBlockFormat({ kind: 'heading', level })).run();
    const list = (kind: 'taskList' | 'bulletList' | 'orderedList') => () => this.editor.chain().command(setBlockFormat({ kind })).run();
    return {
      'Mod-Shift-1': heading(1),
      'Mod-Shift-2': heading(2),
      'Mod-Shift-3': heading(3),
      'Mod-Shift-4': heading(4),
      'Mod-Shift-7': list('taskList'),
      'Mod-Shift-8': list('bulletList'),
      'Mod-Shift-9': list('orderedList'),
    };
  },
});

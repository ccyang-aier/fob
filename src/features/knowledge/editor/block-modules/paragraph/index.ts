import { TextT } from '@phosphor-icons/react';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';

export const ParagraphModule: EditorBlockModule = {
  name: 'paragraph',
  icon: TextT,
  insert: (editor) => editor.chain().command(setBlockFormat({ kind: 'paragraph' })).run(),
};

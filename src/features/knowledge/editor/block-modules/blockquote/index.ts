import { Quotes } from '@phosphor-icons/react';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { BlockquoteInputRule } from './input-rule';

export const BlockquoteModule: EditorBlockModule = {
  name: 'blockquote',
  icon: Quotes,
  extensions: [BlockquoteInputRule],
  insert: (editor) => editor.chain().command(setBlockFormat({ kind: 'blockquote' })).run(),
};

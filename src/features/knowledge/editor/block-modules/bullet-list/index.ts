import { List } from '@phosphor-icons/react';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { BulletListInputRule } from './input-rule';

export const BulletListModule: EditorBlockModule = {
  name: 'bulletList',
  icon: List,
  extensions: [BulletListInputRule],
  shortcut: '⌃ ⇧ 8',
  insert: (editor) => editor.chain().command(setBlockFormat({ kind: 'bulletList' })).run(),
};

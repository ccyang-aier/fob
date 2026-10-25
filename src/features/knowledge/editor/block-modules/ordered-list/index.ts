import { ListNumbers } from '@/components/icons';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { OrderedListInputRule } from './input-rule';

export const OrderedListModule: EditorBlockModule = {
  name: 'orderedList',
  icon: ListNumbers,
  extensions: [OrderedListInputRule],
  shortcut: '⌃ ⇧ 9',
  insert: (editor) => editor.chain().command(setBlockFormat({ kind: 'orderedList' })).run(),
};

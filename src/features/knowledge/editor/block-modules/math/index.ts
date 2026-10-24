import { Function as FunctionIcon } from '@phosphor-icons/react';
import { insertMathBlock } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { MathNodeView } from './math-node-view';

export const MathModule: EditorBlockModule = {
  name: 'math',
  icon: FunctionIcon,
  insert: (editor) => editor.chain().command(insertMathBlock).run(),
  decorate: (extensions) => withNodeView(extensions, 'math', () => ReactNodeViewRenderer(MathNodeView)),
};

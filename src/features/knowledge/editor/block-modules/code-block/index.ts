import { Code } from '@phosphor-icons/react';
import { setBlockFormat } from '../../extensions/format/block-format';
import type { EditorBlockModule } from '../types';
import { CodeBlockInputRule } from './input-rule';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { CodeBlockNodeView } from './code-block-node-view';
import { CodeHighlight } from './highlight';
import { CodeIndent } from './indent';

export const CodeBlockModule: EditorBlockModule = {
  name: 'codeBlock',
  icon: Code,
  extensions: [CodeBlockInputRule, CodeHighlight, CodeIndent],
  insert: (editor) => editor.chain().command(setBlockFormat({ kind: 'codeBlock' })).run(),
  decorate: (extensions) => withNodeView(extensions, 'codeBlock', () => ReactNodeViewRenderer(CodeBlockNodeView)),
};

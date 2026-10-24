import { Sparkle } from '@phosphor-icons/react';
import { insertBuiltNodes } from '../insert';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { AiBlockNodeView } from './ai-block-node-view';

export const AiBlockModule: EditorBlockModule = {
  name: 'aiBlock', icon: Sparkle,
  insert: insertBuiltNodes((nodes) => [nodes.aiBlock.create(null, [nodes.paragraph.create()])]),
  decorate: (extensions, context) => withNodeView(extensions, 'aiBlock', () => ReactNodeViewRenderer((props) => createElement(AiBlockNodeView, { ...props, scope: context.scope }))),
};

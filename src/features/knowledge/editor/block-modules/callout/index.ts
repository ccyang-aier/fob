import { Info } from '@phosphor-icons/react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { insertBuiltNodes } from '../insert';
import type { EditorBlockModule } from '../types';
import { CalloutNodeView } from './callout-node-view';

export const CalloutModule: EditorBlockModule = {
  name: 'callout', icon: Info,
  insert: insertBuiltNodes((nodes) => [nodes.callout.create(null, [nodes.paragraph.create()])]),
  decorate: (extensions) => withNodeView(extensions, 'callout', () => ReactNodeViewRenderer(CalloutNodeView)),
};

import { Globe } from '@/components/icons';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { EmbedNodeView } from './embed-node-view';

export const EmbedModule: EditorBlockModule = {
  name: 'embed', icon: Globe, insert: insertAtom('embed'),
  choices: [
    { name: 'embed', title: 'Embed', insert: insertAtom('embed') },
    { name: 'bilibili', title: 'Bilibili video', keywords: ['bilibili', 'b站', '哔哩哔哩'], insert: insertAtom('embed') },
  ],
  decorate: (extensions) => withNodeView(extensions, 'embed', () => ReactNodeViewRenderer(EmbedNodeView)),
};

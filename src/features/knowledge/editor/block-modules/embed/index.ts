import { Globe } from '@phosphor-icons/react';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { EmbedNodeView } from './embed-node-view';

export const EmbedModule: EditorBlockModule = { name: 'embed', icon: Globe, insert: insertAtom('embed'), decorate: (extensions) => withNodeView(extensions, 'embed', () => ReactNodeViewRenderer(EmbedNodeView)) };

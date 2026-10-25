import { Image as ImageIcon } from '@/components/icons';
import { insertMedia } from '../media-core/insert-media';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { ImageNodeView } from './image-node-view';

export const ImageModule: EditorBlockModule = { name: 'image', icon: ImageIcon, insert: insertMedia('image'), decorate: (extensions, context) => withNodeView(extensions, 'image', () => ReactNodeViewRenderer((props) => createElement(ImageNodeView, { ...props, localKnowledgeBaseId: context.localKnowledgeBaseId, knowledgeBaseId: context.scope?.knowledgeBaseId }))) };

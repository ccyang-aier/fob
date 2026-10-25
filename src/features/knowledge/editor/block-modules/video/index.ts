import { Video } from '@/components/icons';
import { insertMedia } from '../media-core/insert-media';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { VideoNodeView } from './video-node-view';

export const VideoModule: EditorBlockModule = { name: 'video', icon: Video, insert: insertMedia('video'), decorate: (extensions, context) => withNodeView(extensions, 'video', () => ReactNodeViewRenderer((props) => createElement(VideoNodeView, { ...props, localKnowledgeBaseId: context.localKnowledgeBaseId, knowledgeBaseId: context.scope?.knowledgeBaseId }))) };

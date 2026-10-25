import { Article } from '@/components/icons';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { FileNodeView } from './file-node-view';

export const FileModule: EditorBlockModule = { name: 'file', icon: Article, insert: insertAtom('file'), decorate: (extensions, context) => withNodeView(extensions, 'file', () => ReactNodeViewRenderer((props) => createElement(FileNodeView, { ...props, localKnowledgeBaseId: context.localKnowledgeBaseId, knowledgeBaseId: context.scope?.knowledgeBaseId ?? context.knowledgeBaseId }))) };

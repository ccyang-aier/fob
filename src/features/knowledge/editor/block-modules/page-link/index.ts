import { Article } from '@/components/icons';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { PageLinkNodeView } from './page-link-node-view';

export const PageLinkModule: EditorBlockModule = { name: 'pageLink', icon: Article, insert: insertAtom('pageLink'), decorate: (extensions, context) => withNodeView(extensions, 'pageLink', () => ReactNodeViewRenderer((props) => createElement(PageLinkNodeView, { ...props, knowledgeBaseId: context.scope?.knowledgeBaseId ?? context.localKnowledgeBaseId, getLocalPages: context.getLocalPages }))) };

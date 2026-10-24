import { Database } from '@phosphor-icons/react';
import { insertAtom } from '../insert';
import type { EditorBlockModule } from '../types';
import { createElement } from 'react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { DatabaseViewNodeView } from './database-view-node-view';

export const DatabaseViewModule: EditorBlockModule = { name: 'databaseView', icon: Database, insert: insertAtom('databaseView'), decorate: (extensions, context) => withNodeView(extensions, 'databaseView', () => ReactNodeViewRenderer((props) => createElement(DatabaseViewNodeView, { ...props, scope: context.scope }))) };

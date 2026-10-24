import { Columns } from '@phosphor-icons/react';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { withNodeView } from '../../extensions/with-node-view';
import { insertBuiltNodes } from '../insert';
import type { EditorBlockModule } from '../types';
import { ColumnsNodeView } from './columns-node-view';

export const ColumnsModule: EditorBlockModule = {
  name: 'columns', icon: Columns,
  insert: insertBuiltNodes((nodes) => [nodes.columns.create(null, [
    nodes.column.create(null, [nodes.paragraph.create()]),
    nodes.column.create(null, [nodes.paragraph.create()]),
  ])]),
  decorate: (extensions) => withNodeView(extensions, 'columns', () => ReactNodeViewRenderer(ColumnsNodeView)),
};

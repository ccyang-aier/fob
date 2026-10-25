import { Table } from '@/components/icons';
import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { columnResizing, goToNextCell, tableEditing } from '@tiptap/pm/tables';
import { withNodeView } from '../../extensions/with-node-view';
import { insertBuiltNodes } from '../insert';
import type { EditorBlockModule } from '../types';
import { TableNodeView } from './table-node-view';
import { pinTableHeaders, tableHeaderPlugin } from './table-header';
import { addRow } from './table-commands';

const cell = (type: NodeType | undefined, nodes: Record<string, NodeType>): ProseMirrorNode | null =>
  type && nodes.paragraph ? type.create(null, [nodes.paragraph.create()]) : null;

export const TableModule: EditorBlockModule = {
  name: 'table', icon: Table,
  insert: insertBuiltNodes((nodes) => {
    if (!nodes.tableHeader || !nodes.tableCell || !nodes.paragraph) throw new TypeError('table cell types missing');
    return [nodes.table.create(null, Array.from({ length: 3 }, (_, index) =>
      nodes.tableRow.create(null, Array.from({ length: 3 }, () => cell(index === 0 ? nodes.tableHeader : nodes.tableCell, nodes)!))))];
  }),
  decorate: (extensions) => [...withNodeView(extensions, 'table', () => ReactNodeViewRenderer(TableNodeView, {
    contentDOMElementTag: 'tbody', selectedOnTextSelection: true,
  })), Extension.create({
    name: 'fobTableEditing',
    addProseMirrorPlugins() {
      return [columnResizing({ View: null, cellMinWidth: 60, defaultCellMinWidth: 90 }), tableEditing(), tableHeaderPlugin(() => this.editor.isEditable)];
    },
    onCreate() {
      if (!this.editor.isEditable) return;
      const tr = pinTableHeaders(this.editor.state.tr);
      if (tr.docChanged) this.editor.view.dispatch(tr.setMeta('addToHistory', false));
    },
    addKeyboardShortcuts() {
      return {
        Tab: () => this.editor.isEditable && this.editor.commands.command(({ state, dispatch }) => goToNextCell(1)(state, dispatch) || addRow(state, dispatch)),
        'Shift-Tab': () => this.editor.isEditable && this.editor.commands.command(({ state, dispatch }) => goToNextCell(-1)(state, dispatch)),
      };
    },
  })],
};

export {
  addRow, addColumn, toggleHeaderRow, deleteRow, deleteColumn, deleteTable,
  tableNodeAt, insertRowAbove, insertRowBelow, insertColumnLeft, insertColumnRight,
  toggleTableHeaderRow, removeTableRow, removeTableColumn, removeTable,
} from './table-commands';
export type { ColumnWhere, RowWhere, TableHit } from './table-commands';

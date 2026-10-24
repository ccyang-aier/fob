import { Plugin } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Fragment, type Node as ProseMirrorNode } from '@tiptap/pm/model';

export function pinTableHeaders(tr: Transaction): Transaction {
  tr.doc.descendants((table, pos) => {
    if (table.type.spec.tableRole !== 'table') return true;
    const fullHeader = (row: ProseMirrorNode) => row.childCount > 0 && Array.from({ length: row.childCount }, (_, i) => row.child(i)).every(cell => cell.type.spec.tableRole === 'header_cell');
    if (!table.firstChild || fullHeader(table.firstChild)) return true;
    const rows: ProseMirrorNode[] = [];
    let spans = false;
    table.forEach(row => { rows.push(row); row.forEach(cell => { if (cell.attrs.rowspan > 1) spans = true; }); });
    const displaced = rows.findIndex(fullHeader);
    if (displaced < 1 || spans) return true;
    rows.unshift(rows.splice(displaced, 1)[0]);
    tr.replaceWith(pos, pos + table.nodeSize, table.copy(Fragment.fromArray(rows)));
    return false;
  });
  return tr;
}

export const tableHeaderPlugin = (isEditable: () => boolean) => new Plugin({
  appendTransaction(transactions, _previous, current) {
    if (!isEditable() || !transactions.some(tr => tr.docChanged)) return null;
    const tr = pinTableHeaders(current.tr);
    return tr.docChanged ? tr : null;
  },
});

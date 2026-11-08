import { EditorState, Selection } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { insertTableAxis, type TableCommand } from './table-commands';

/** Append in one transaction so a drag is one undo step, even across merged cells. */
export function appendTableAxes(pos: number, axis: 'row' | 'column', count: number): TableCommand {
  return (state, dispatch) => {
    if (!Number.isInteger(count) || count < 1 || count > 100) return false;
    if (!Number.isInteger(pos) || pos < 0 || pos >= state.doc.content.size) return false;
    if (state.doc.nodeAt(pos)?.type.spec.tableRole !== 'table') return false;
    if (!dispatch) return true;
    const batch = state.tr;
    // Tiptap command states reuse their transaction getter. Build the individual
    // insertions from an independent state before replaying their steps into it.
    let current = EditorState.create({ doc: batch.doc, selection: batch.selection });
    for (let index = 0; index < count; index++) {
      const map = TableMap.get(current.doc.nodeAt(pos)!);
      insertTableAxis(current, transaction => {
        for (const step of transaction.steps) batch.step(step);
        batch.setSelection(Selection.fromJSON(batch.doc, transaction.selection.toJSON()));
        current = current.apply(transaction);
      }, pos, axis, axis === 'row' ? map.height : map.width);
    }
    dispatch(batch.scrollIntoView());
    return true;
  };
}

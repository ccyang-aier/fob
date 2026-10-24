/**
 * The one Tiptap extension that binds the editor to the page session (E03).
 *
 * `ySyncPlugin` attaches the shared registry schema (E01) to the B04 Y.Doc's
 * page body fragment — the document, never component state, stays the only
 * body authority. `yUndoPlugin` runs on the B08 local undo manager, so undo
 * only ever reverts this connection's own writing, and the y-prosemirror undo
 * helpers restore the selection that belonged to each stack item.
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { blockIdPluginKey } from '@fob/shared/knowledge/schema';
import { redo, undo, ySyncPlugin, yUndoPlugin } from 'y-prosemirror';
import type * as Y from 'yjs';
import type { PageUndo } from '../collaboration/page-undo';

/**
 * The page body fragment of the knowledge document model. The collaboration
 * server and the backend indexers read the same name (`PAGE_BODY_FRAGMENT`
 * in backend/server/src/modules/knowledge/search/backlinks.ts) and it is y-prosemirror's
 * conventional default; keep the three in lockstep.
 */
export const PAGE_BODY_FRAGMENT = 'default';

const historyReconcileKey = new PluginKey('fobPageHistoryReconcile');

/**
 * Two y-prosemirror semantics have to be reconciled with B08 here:
 *
 * 1. **Repairs close their batch.** E02's blockId repairs end every
 *    repair-bearing batch with `addToHistory: false` (correct for a plain PM
 *    history plugin), but y-prosemirror mirrors the batch's *last*
 *    transaction flag onto the single Y transaction it pushes for the whole
 *    batch — silently dropping the user's own block edit from the undo
 *    stack. A trailing meta-only transaction restores the flag whenever a
 *    real content change and a repair share one batch; repair-only
 *    dispatches (e.g. the initial `onCreate` pass) are roots themselves and
 *    stay out of the history.
 *
 * 2. **Selection-only batches would poison the stacks.** After the first
 *    content change y-prosemirror pushes *every* subsequent dispatch —
 *    including caret moves, focus and other step-less transactions — as an
 *    (empty) Y transaction, and Yjs clears the redo stack on any captured
 *    transaction. Marking selection-only batches `addToHistory: false`
 *    keeps them out of the undo manager entirely, like PM history does.
 */
function pageHistoryReconcilePlugin() {
  return new Plugin({
    key: historyReconcileKey,
    appendTransaction: (transactions: readonly Transaction[], _oldState, newState) => {
      const last = transactions[transactions.length - 1];
      if (!last || last.getMeta(historyReconcileKey) !== undefined) return null;

      // Rule 1: a repair closes a batch whose root is a real user change —
      // restore the flag so the combined push stays one undoable unit.
      // (Repair-only dispatches are roots themselves and stay out.)
      if (last.getMeta('addToHistory') === false && last.getMeta(blockIdPluginKey) === true) {
        const root = (last.getMeta('appendedTransaction') as Transaction | undefined) ?? last;
        if (root.docChanged && root.getMeta(blockIdPluginKey) !== true) {
          return newState.tr.setMeta(historyReconcileKey, 'repair-reconciled').setMeta('addToHistory', true);
        }
        return null;
      }

      // Rule 2: selection-only batches stay out of the history.
      if (transactions.some((tr) => tr.docChanged)) return null;
      if (last.getMeta('addToHistory') === false) return null;
      return newState.tr.setMeta(historyReconcileKey, 'selection-only').setMeta('addToHistory', false);
    },
  });
}

export function pageCollaborationExtension(document: Y.Doc, pageUndo: PageUndo) {
  return Extension.create({
    name: 'fobPageCollaboration',
    addProseMirrorPlugins() {
      return [
        ySyncPlugin(document.getXmlFragment(PAGE_BODY_FRAGMENT)),
        yUndoPlugin({ undoManager: pageUndo.local }),
        pageHistoryReconcilePlugin(),
      ];
    },
    // y-prosemirror ships no keymap of its own and there is no PM history
    // plugin to conflict with (B08's manager is the only undo stack).
    addKeyboardShortcuts() {
      const run = (apply: typeof undo) => () => (this.editor.isEditable ? apply(this.editor.state) : true);
      return {
        'Mod-z': run(undo),
        'Mod-Shift-z': run(redo),
        'Mod-y': run(redo),
      };
    },
  });
}

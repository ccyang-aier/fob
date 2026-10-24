import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import type { Schema } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';

import { applyBlockIdRepairs, planBlockIdRepairs } from './block-id';
import type { BlockIdOptions } from './block-id';
import { createBlockClipboardSerializer, readBlockClipboardSource, reidentifyPastedSlice } from './block-id-clipboard';

export const blockIdPluginKey = new PluginKey('fobBlockId');

export function createBlockIdRepairTransaction(state: EditorState, options: BlockIdOptions = {}): Transaction | null {
  const repairs = planBlockIdRepairs(state.doc, options);
  return repairs.length ? applyBlockIdRepairs(state.tr, repairs)
    .setMeta(blockIdPluginKey, true).setMeta('addToHistory', false) : null;
}

export interface BlockIdPluginOptions extends BlockIdOptions {
  pageId: string;
  schema: Schema;
}

export function createBlockIdPlugin(options: BlockIdPluginOptions): Plugin {
  // The source belongs to one synchronous clipboard parse in one view. A second
  // editor or plain-text paste cannot accidentally consume another page's source.
  const clipboard = new WeakMap<EditorView, { sourcePageId: string | null; moving: boolean }>();
  return new Plugin({
    key: blockIdPluginKey,
    appendTransaction(transactions, _oldState, newState) {
      if (!transactions.some((transaction) => transaction.docChanged && !transaction.getMeta(blockIdPluginKey))) return null;
      return createBlockIdRepairTransaction(newState, options);
    },
    props: {
      clipboardSerializer: createBlockClipboardSerializer(options.schema, options.pageId),
      transformPastedHTML(html, view) {
        clipboard.set(view, { sourcePageId: readBlockClipboardSource(html), moving: false });
        return html;
      },
      transformPastedText(text, _plain, view) { clipboard.delete(view); return text; },
      transformPasted(slice, view, plain) {
        const context = clipboard.get(view);
        clipboard.delete(view);
        if (context?.moving) return slice;
        return reidentifyPastedSlice(slice, {
          targetPageId: options.pageId, sourcePageId: plain ? null : context?.sourcePageId,
          targetDoc: view.state.doc, generateId: options.generateId,
        });
      },
      handleDOMEvents: {
        drop(view, event) {
          let copies: boolean | undefined;
          view.someProp('dragCopies', (test) => { copies = copies || test(event); });
          const platform = view.dom.ownerDocument.defaultView?.navigator.platform ?? '';
          const copyModifier = /Mac/.test(platform) ? event.altKey : event.ctrlKey;
          clipboard.set(view, { sourcePageId: options.pageId, moving: !!view.dragging && !(copies ?? copyModifier) });
          return false;
        },
      },
    },
  });
}

/** The frontend adds NodeViews/commands separately; this extension owns identity only. */
export function createBlockIdExtension(options: Omit<BlockIdPluginOptions, 'schema'>): Extension {
  return Extension.create({
    name: 'fobBlockId',
    addProseMirrorPlugins() { return [createBlockIdPlugin({ ...options, schema: this.editor.schema })]; },
    onCreate() {
      const transaction = createBlockIdRepairTransaction(this.editor.state, options);
      if (transaction) this.editor.view.dispatch(transaction);
    },
  });
}

import type { Editor } from '@tiptap/core';
import { commentsPluginKey } from './comments-plugin';

export type CommentComposePoint = { x: number; y: number };
const composers = new WeakMap<Editor, (point: CommentComposePoint) => void>();

/** Per-editor UI bridge: the existing comments controller retains permission and persistence ownership. */
export function bindSelectionCommentComposer(editor: Editor, compose: (point: CommentComposePoint) => void) {
  composers.set(editor, compose);
  editor.view.dispatch(editor.state.tr.setMeta(commentsPluginKey, { type: 'context' }).setMeta('addToHistory', false));
  return () => {
    if (composers.get(editor) !== compose) return;
    composers.delete(editor);
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(commentsPluginKey, { type: 'context' }).setMeta('addToHistory', false));
  };
}

export const canComposeSelectionComment = (editor: Editor) => composers.has(editor);
export function requestSelectionComment(editor: Editor, point: CommentComposePoint) { composers.get(editor)?.(point); }

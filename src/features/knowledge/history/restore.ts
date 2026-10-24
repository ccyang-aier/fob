/**
 * The restore primitive (V03 §5.3): replacing the whole editor body with a
 * checkpoint is ONE ProseMirror transaction, so y-prosemirror maps it onto a
 * single Y.Doc transaction — the restoring editor can undo it (B08 tracks
 * this connection's own writes) and every other editor receives an ordinary
 * remote update. Nobody is interrupted, and there is no server-side rewrite.
 *
 * All functions take the live editor's schema: the checkpoint body is shared
 * document JSON, but validation and rendering must run against the same
 * schema instance the editor mounts.
 */

import { DOMSerializer } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';

/** Validates checkpoint JSON against the editor schema; null when undecodable. */
export function checkpointBodyToNode(body: unknown, schema: Schema): ProseMirrorNode | null {
  try {
    const node = schema.nodeFromJSON(body);
    return node.type === schema.topNodeType ? node : null;
  } catch {
    return null;
  }
}

/** One replaceWith step from the whole current body to the checkpoint body. */
export function buildRestoreTransaction(state: EditorState, body: unknown): Transaction | null {
  const target = checkpointBodyToNode(body, state.schema);
  if (!target) return null;
  return state.tr.replaceWith(0, state.doc.content.size, target.content);
}

/** Read-only preview rendering without mounting an editor instance. */
export function renderCheckpointHtml(body: unknown, schema: Schema): string | null {
  const node = checkpointBodyToNode(body, schema);
  if (!node) return null;
  const serializer = DOMSerializer.fromSchema(schema);
  const host = document.createElement('div');
  // The doc wrapper has no toDOM spec; its content fragment is the body.
  host.appendChild(serializer.serializeFragment(node.content));
  return host.innerHTML;
}

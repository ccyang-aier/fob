import type { Editor } from '@tiptap/core';
import type { Node } from '@tiptap/pm/model';
import { collectSuggestions, reviewSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';

/** Preserve rich blocks such as diagrams and tables when requesting a revision. */
export function aiDraftMarkdown(node: Node): string {
  const schema = node.type.schema;
  return createMarkdownPipeline({ schema }).serialize(schema.topNodeType.create(null, node.content));
}

export function findAiBlock(document: Node, blockId: string): { node: Node; position: number } | null {
  let found: { node: Node; position: number } | null = null;
  document.descendants((node, position) => {
    if (node.type.name === 'aiBlock' && node.attrs.blockId === blockId) { found = { node, position }; return false; }
    return !found;
  });
  return found;
}

/** Select the completed draft without introducing an undo step or global review state. */
export function selectAiDraft(editor: Editor, blockId: string): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const draft = findAiBlock(editor.state.doc, blockId);
  if (!draft) return false;
  let from: number | null = null, to: number | null = null;
  draft.node.descendants((node, offset) => {
    if (!node.isText) return;
    from ??= draft.position + 1 + offset;
    to = draft.position + 1 + offset + node.nodeSize;
  });
  if (from === null || to === null) return false;
  editor.commands.setTextSelection({ from, to });
  editor.view.focus();
  return true;
}

/** One human transaction decides this draft only and restores ordinary document blocks. */
export function acceptAiBlock(editor: Editor, blockId: string): boolean {
  if (!editor.isEditable) return false;
  const current = findAiBlock(editor.state.doc, blockId);
  if (!current) return false;
  const ids = collectSuggestions(current.node).map(item => item.suggestionId);
  const tr = ids.length ? reviewSuggestions(editor.state, { decision: 'accept', suggestionIds: ids }) : editor.state.tr;
  const accepted = findAiBlock(tr.doc, blockId);
  if (!accepted) return false;
  tr.replaceWith(accepted.position, accepted.position + accepted.node.nodeSize, accepted.node.content);
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.focus();
  return true;
}

/** Reject only proposal ranges in this block. Human text and other drafts remain intact. */
export function undoAiBlock(editor: Editor, blockId: string): boolean {
  if (!editor.isEditable) return false;
  const current = findAiBlock(editor.state.doc, blockId);
  if (!current) return false;
  const ids = collectSuggestions(current.node).map(item => item.suggestionId);
  if (!ids.length) return false;
  const tr = reviewSuggestions(editor.state, { decision: 'reject', suggestionIds: ids });
  const draft = findAiBlock(tr.doc, blockId);
  if (draft) tr.setNodeMarkup(draft.position, undefined, { ...draft.node.attrs, taskId: null });
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

export function aiBlockHasContent(node: Node): boolean {
  let populated = false;
  node.forEach(child => { if (child.type.name !== 'paragraph' || child.textContent.trim()) populated = true; });
  return populated;
}

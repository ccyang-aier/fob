import { Fragment, Slice } from '@tiptap/pm/model';
import type { Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Selection } from '@tiptap/pm/state';
import { nanoid } from 'nanoid';
import { suggestionMetadataSchema } from '../annotations';
import type { NodeAnnotation, SuggestionMetadata } from '../annotations';
import { applyBlockIdRepairs, planBlockIdRepairs } from '../block-id';
import { isKnowledgeBlock } from '../types';
import { isSuggestionMark, nodeAnnotations } from './collect';

export const suggestionTransactionMeta = 'fob:suggestion';

export function newSuggestion(author: string, options: { suggestionId?: string; createdAt?: string } = {}): SuggestionMetadata {
  return suggestionMetadataSchema.parse({ author, suggestionId: options.suggestionId ?? nanoid(), createdAt: options.createdAt ?? new Date().toISOString() });
}

function annotateInsertion(slice: Slice, metadata: SuggestionMetadata, insert: Mark): Slice {
  const annotation: NodeAnnotation = { type: 'suggestion_insert', attrs: metadata };
  function rewrite(fragment: Fragment): Fragment {
    const nodes: ProseMirrorNode[] = [];
    fragment.forEach((node) => {
      const marks = node.marks.filter((mark) => !isSuggestionMark(mark.type.name));
      if (node.isText) nodes.push(node.mark(insert.addToSet(marks)));
      else nodes.push(node.type.create({
        ...node.attrs,
        ...('annotations' in node.attrs ? { annotations: [annotation] } : {}),
        ...(isKnowledgeBlock(node) ? { blockId: null, sourceBlockId: null } : {}),
      }, rewrite(node.content), marks));
    });
    return Fragment.fromArray(nodes);
  }
  return new Slice(rewrite(slice.content), slice.openStart, slice.openEnd);
}

function suggestDeletion(transaction: Transaction, from: number, to: number, metadata: SuggestionMetadata): void {
  const deletion = transaction.doc.type.schema.marks.suggestion_delete.create(metadata);
  const remove: { from: number; to: number }[] = [];
  let touched = false;
  transaction.doc.nodesBetween(from, to, (node, position) => {
    const start = Math.max(from, position); const end = Math.min(to, position + node.nodeSize);
    if (start >= end) return false;
    const annotations = nodeAnnotations(node);
    if (!node.isText && start === position && end === position + node.nodeSize && 'annotations' in node.attrs) {
      touched = true;
      if (annotations.some((item) => item.type === 'suggestion_insert' && item.attrs.author === metadata.author)) remove.push({ from: start, to: end });
      else if (!annotations.some((item) => item.type === 'suggestion_delete')) {
        transaction.setNodeMarkup(position, undefined, { ...node.attrs, annotations: [...annotations, { type: 'suggestion_delete', attrs: metadata }] }, node.marks);
      }
      return false;
    }
    if (!node.isText) return;
    touched = true;
    if (node.marks.some((mark) => mark.type.name === 'suggestion_insert' && mark.attrs.author === metadata.author)) remove.push({ from: start, to: end });
    else if (!node.marks.some((mark) => mark.type.name === 'suggestion_delete')) transaction.addMark(start, end, deletion);
  });
  if (!touched && from !== to) throw new RangeError('A structural boundary must be reviewed as a block replacement');
  // Editing one's own pending insertion removes it; it does not create an
  // overlapping deletion proposal. All other original content remains present.
  for (const range of remove.reverse()) transaction.delete(range.from, range.to);
}

/**
 * The editor and Agent use the same command before applying a text/slice edit.
 * Structural commands pass complete affected blocks, preserving both alternatives
 * for review instead of pretending a removed paragraph boundary is text.
 */
export function suggestReplacement(state: EditorState, input: {
  from: number;
  to: number;
  replacement?: Slice;
  suggestion: SuggestionMetadata;
}): Transaction {
  const { from, to } = input;
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to < from || to > state.doc.content.size) throw new RangeError('Invalid suggestion range');
  const metadata = suggestionMetadataSchema.parse(input.suggestion);
  const transaction = state.tr;
  if (from !== to) suggestDeletion(transaction, from, to, metadata);
  const insertionPoint = transaction.mapping.map(to, -1);
  if (input.replacement?.size) {
    const insert = state.schema.marks.suggestion_insert.create(metadata);
    transaction.replaceRange(insertionPoint, insertionPoint, annotateInsertion(input.replacement, metadata, insert));
  }
  applyBlockIdRepairs(transaction, planBlockIdRepairs(transaction.doc));
  const selectionPoint = transaction.mapping.map(to, 1);
  transaction.setSelection(Selection.near(transaction.doc.resolve(Math.min(selectionPoint, transaction.doc.content.size)), -1));
  transaction.setMeta(suggestionTransactionMeta, { operation: 'propose', suggestionId: metadata.suggestionId });
  transaction.doc.check();
  return transaction;
}

export function suggestText(state: EditorState, input: {
  from: number;
  to: number;
  text: string;
  suggestion: SuggestionMetadata;
}): Transaction {
  const marks = state.storedMarks ?? state.doc.resolve(input.from).marks();
  return suggestReplacement(state, {
    ...input, replacement: new Slice(input.text ? Fragment.from(state.schema.text(input.text, marks)) : Fragment.empty, 0, 0),
  });
}

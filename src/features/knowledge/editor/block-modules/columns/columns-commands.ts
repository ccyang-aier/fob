import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { Editor } from '@tiptap/core';

export function setColumnWidths(editor: Editor, node: ProseMirrorNode, pos: number, widths: readonly number[]): boolean {
  if (widths.length !== node.childCount || widths.some((width) => !Number.isSafeInteger(width) || width < 1)) return false;
  const tr = editor.state.tr;
  node.forEach((column, offset, index) => tr.setNodeMarkup(pos + 1 + offset, undefined, { ...column.attrs, width: widths[index] }));
  editor.view.dispatch(tr);
  return true;
}

export function addColumn(editor: Editor, node: ProseMirrorNode, pos: number): boolean {
  if (node.childCount >= 4) return false;
  let sum = 0;
  node.forEach(column => { sum += Number(column.attrs.width); });
  const column = editor.schema.nodes.column.create({ width: Math.max(1, Math.round(sum / node.childCount)) }, [editor.schema.nodes.paragraph.create()]);
  editor.view.dispatch(editor.state.tr.insert(pos + node.nodeSize - 1, column));
  return true;
}

/** Fold the last column into its left neighbor so removing a column never drops content. */
export function removeLastColumn(editor: Editor, node: ProseMirrorNode, pos: number): boolean {
  if (node.childCount <= 2) return false;
  const previous = node.child(node.childCount - 2);
  const last = node.lastChild!;
  let previousOffset = 0;
  for (let index = 0; index < node.childCount - 2; index += 1) previousOffset += node.child(index).nodeSize;
  const previousPos = pos + 1 + previousOffset;
  const lastPos = previousPos + previous.nodeSize;
  const tr = editor.state.tr;
  tr.setNodeMarkup(previousPos, undefined, { ...previous.attrs, width: Number(previous.attrs.width) + Number(last.attrs.width) });
  const content = last.content;
  const onlyEmptyParagraph = last.childCount === 1 && last.firstChild?.type.name === 'paragraph' && !last.firstChild.content.size;
  if (!onlyEmptyParagraph) tr.insert(previousPos + previous.nodeSize - 1, content);
  const mappedLast = tr.mapping.map(lastPos);
  tr.delete(mappedLast, mappedLast + last.nodeSize);
  editor.view.dispatch(tr);
  return true;
}

import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';

/** Operate on one code block, preserving the selection and all other blocks. */
export function indentCode(editor: Editor, outdent = false): boolean {
  const { selection, tr } = editor.state;
  const { $from, $to, from, to } = selection;
  if (!editor.isEditable || $from.parent.type.name !== 'codeBlock' || !$from.sameParent($to)) return false;
  if (!outdent && selection.empty) { editor.view.dispatch(tr.insertText('  ', from).scrollIntoView()); return true; }
  const text = $from.parent.textContent;
  const blockStart = $from.start();
  const start = $from.parentOffset === 0 ? 0 : text.lastIndexOf('\n', $from.parentOffset - 1) + 1;
  const end = $to.parentOffset > start && text[$to.parentOffset - 1] === '\n' ? $to.parentOffset - 1 : $to.parentOffset;
  const changes: { position: number; remove: number }[] = [];
  for (let offset = start; offset <= end; ) {
    changes.push({ position: blockStart + offset, remove: outdent ? (text.slice(offset).match(/^(?:\t| {1,2})/)?.[0].length ?? 0) : 0 });
    const next = text.indexOf('\n', offset);
    if (next < 0 || next >= end) break;
    offset = next + 1;
  }
  for (const change of changes.reverse()) {
    if (outdent && change.remove) tr.delete(change.position, change.position + change.remove);
    else if (!outdent) tr.insertText('  ', change.position);
  }
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(from), tr.mapping.map(to)));
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}
export const CodeIndent = Extension.create({
  name: 'fobCodeIndent', priority: 1000,
  addKeyboardShortcuts() { return { Tab: () => indentCode(this.editor), 'Shift-Tab': () => indentCode(this.editor, true) }; },
});

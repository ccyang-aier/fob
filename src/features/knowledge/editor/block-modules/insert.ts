import type { Editor } from '@tiptap/core';
import type { NodeType, Node as ProseMirrorNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import type { BlockInsertCommand } from './types';

const sizeOf = (nodes: readonly ProseMirrorNode[]): number => nodes.reduce((total, node) => total + node.nodeSize, 0);

/** Structural insertion replaces an empty trigger paragraph and leaves a fresh caret paragraph. */
export function insertBlockNodes(nodes: readonly ProseMirrorNode[]): BlockInsertCommand {
  return (editor: Editor) => {
    const paragraph = editor.schema.nodes.paragraph;
    if (!paragraph || !nodes.length) return false;
    const { $anchor } = editor.state.selection;
    const trail = paragraph.create();
    const tr = editor.state.tr;
    if ($anchor.parent.type === paragraph && $anchor.parent.content.size === 0 && $anchor.depth === 1) {
      const before = $anchor.before();
      tr.replaceWith(before, $anchor.after(), [...nodes, trail]);
      tr.setSelection(TextSelection.near(tr.doc.resolve(before + sizeOf(nodes) + 1), 1));
    } else {
      const after = $anchor.before(1) + $anchor.node(1).nodeSize;
      tr.insert(after, [...nodes, trail]);
      tr.setSelection(TextSelection.near(tr.doc.resolve(after + sizeOf(nodes) + 1), 1));
    }
    editor.view.dispatch(tr.scrollIntoView());
    return true;
  };
}

export function insertBuiltNodes(build: (nodes: Record<string, NodeType>) => readonly ProseMirrorNode[]): BlockInsertCommand {
  return (editor) => {
    try { return insertBlockNodes(build(editor.schema.nodes))(editor); }
    catch { return false; }
  };
}

export function insertAtom(name: string): BlockInsertCommand {
  return insertBuiltNodes((nodes) => [nodes[name].create()]);
}

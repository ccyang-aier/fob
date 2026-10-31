import type { Node } from '@tiptap/pm/model';

// ProseMirror documents are immutable. Sharing one count avoids repeated snapshots
// and duplicate progress views scanning the same document; old versions can be collected.
const checkedCounts = new WeakMap<Node, number>();

export function countCheckedTasks(document: Node): number {
  const cached = checkedCounts.get(document);
  if (cached !== undefined) return cached;
  let checked = 0;
  document.descendants(node => {
    if (node.type.name === 'taskItem' && node.attrs.checked) checked++;
  });
  checkedCounts.set(document, checked);
  return checked;
}

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

/** A blank writing line, including whitespace/breaks, but never an inline atom or code block. */
export function isBlankTextBlock(node: ProseMirrorNode | null): boolean {
  if (!node?.isTextblock || node.type.spec.code || node.textContent.trim()) return false;
  let blank = true;
  node.forEach(child => { if (!child.isText && child.type.name !== 'hardBreak') blank = false; });
  return blank;
}

/**
 * Shared ProseMirror position helpers for the E04 editing behaviors
 * (input rules, keyboard editing, format commands).
 *
 * Everything resolves node types by name from the live schema of the shared
 * E01 registry, so no second schema knowledge exists here. The registry may
 * re-order or extend blocks; missing types simply never match.
 */

import type { Node as ProseMirrorNode, NodeType, ResolvedPos, Schema } from '@tiptap/pm/model';

export interface AncestorHit {
  node: ProseMirrorNode;
  /** Position directly before the ancestor node. */
  pos: number;
  /** Depth of the ancestor in the resolved position. */
  depth: number;
}

/** Nearest ancestor (self excluded) whose type is one of `types`. */
export function nearestAncestor($pos: ResolvedPos, types: readonly NodeType[]): AncestorHit | null {
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const type = $pos.node(depth).type;
    if (types.includes(type)) return { node: $pos.node(depth), pos: $pos.before(depth), depth };
  }
  return null;
}

/** Nearest of either list item kind around the position (innermost wins). */
export function nearestListItem($pos: ResolvedPos, schema: Schema): AncestorHit | null {
  const types = [schema.nodes.taskItem, schema.nodes.listItem].filter(Boolean);
  // taskItem and listItem never share a direct nesting path; whichever is
  // deeper in the ancestor chain is the item the caret edits.
  let best: AncestorHit | null = null;
  for (const type of types) {
    for (let depth = $pos.depth; depth > 0; depth -= 1) {
      if ($pos.node(depth).type === type && (!best || depth > best.depth)) {
        best = { node: $pos.node(depth), pos: $pos.before(depth), depth };
      }
    }
  }
  return best;
}

/** Node types of the wrapping containers the enter/backspace behaviors exit. */
export function wrapContainerTypes(schema: Schema): readonly NodeType[] {
  return [schema.nodes.blockquote, schema.nodes.callout].filter(Boolean);
}

/** The cursor's own textblock is a direct child of the ancestor at `depth`. */
export function isDirectChildOf($pos: ResolvedPos, depth: number): boolean {
  return $pos.depth === depth + 1;
}

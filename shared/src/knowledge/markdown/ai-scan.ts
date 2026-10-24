import { blockIdSchema } from '../contracts';
import { AI_DERIVED_DIRECTIVE } from './ai-types';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownRange } from './ai-types';
import type { AnchorPlacement } from './ai-tree';
import type { MarkdownNode } from './types';

export interface AnchorOccurrence {
  node: MarkdownNode;
  ancestors: readonly MarkdownNode[];
  path: readonly number[];
}
export interface DerivedOccurrence { node: MarkdownNode; path: readonly number[] }

export function scanAiTree(tree: MarkdownNode) {
  const anchors = new Map<string, AnchorOccurrence>();
  const derived: DerivedOccurrence[] = [];
  function visit(node: MarkdownNode, ancestors: MarkdownNode[], path: number[]) {
    if (node.type === 'containerDirective' && node.name === AI_DERIVED_DIRECTIVE) {
      derived.push({ node, path }); return;
    }
    if (node.type === 'blockAnchor') {
      if (!blockIdSchema.safeParse(node.blockId).success || anchors.has(node.blockId!)) {
        throw new KnowledgeMarkdownError('invalid_anchor', `Invalid or duplicate AI anchor: ${node.blockId ?? ''}`, node);
      }
      anchors.set(node.blockId!, { node, ancestors, path }); return;
    }
    node.children?.forEach((child, index) => visit(child, [...ancestors, node], [...path, index]));
  }
  visit(tree, [], []);
  return { anchors, derived };
}

export function nodeRange(node: MarkdownNode): MarkdownRange {
  const from = node.position?.start.offset;
  const to = node.position?.end.offset;
  if (from === undefined || to === undefined) throw new KnowledgeMarkdownError('invalid_anchor', 'AI range extraction requires parsed source positions', node);
  return { from, to };
}

export function occurrenceRange(occurrence: AnchorOccurrence, placement: AnchorPlacement): MarkdownRange {
  const marker = nodeRange(occurrence.node);
  let carrier: MarkdownNode | undefined;
  if (placement.kind === 'after') {
    const paragraph = occurrence.ancestors.at(-1);
    const parent = occurrence.ancestors.at(-2);
    if (paragraph?.type !== 'paragraph') throw new KnowledgeMarkdownError('invalid_anchor', 'Block-end anchor has no standalone carrier', occurrence.node);
    carrier = parent?.children?.[occurrence.path.at(-2)! - 1];
  } else {
    carrier = [...occurrence.ancestors].reverse().find((node) => node.type === placement.type
      && (!placement.name || node.name === placement.name)
      && (!placement.envelopeType || node.attributes?.type === placement.envelopeType));
  }
  if (!carrier || carrier.type !== placement.type || (placement.name && carrier.name !== placement.name)) {
    throw new KnowledgeMarkdownError('invalid_anchor', 'Anchor is not attached to its expected source structure', occurrence.node);
  }
  const range = nodeRange(carrier);
  const from = placement.kind === 'cellText' && carrier.children?.length ? nodeRange(carrier.children[0]).from : range.from;
  return { from, to: Math.max(range.to, marker.to) };
}

/** Read-only derivations never reach the PM decoder, even if they contain anchors. */
export function stripAiProjection(tree: MarkdownNode): MarkdownNode {
  function visit(node: MarkdownNode): MarkdownNode | null {
    if (node.type === 'containerDirective' && node.name === AI_DERIVED_DIRECTIVE) return null;
    if (node.type === 'blockAnchor') return null;
    if (!node.children) return node;
    const children: MarkdownNode[] = [];
    for (const child of node.children) {
      if (child.type === 'blockAnchor') {
        // The anchor handler contributes one separator space, not source text.
        const previous = children.at(-1);
        if (previous?.type === 'text' && previous.value?.endsWith(' ')) {
          previous.value = previous.value.slice(0, -1);
          if (!previous.value) children.pop();
        }
      } else {
        const clean = visit(child);
        if (clean) children.push({ ...clean });
      }
    }
    if (node.type === 'paragraph' && !children.length && node.children.some((child) => child.type === 'blockAnchor')) return null;
    return { ...node, children };
  }
  return visit(tree)!;
}

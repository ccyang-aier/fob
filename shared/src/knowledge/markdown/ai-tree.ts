import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { inspectBlockIds, isKnowledgeBlock } from '../schema';
import type { BlockRegistry } from '../schema';
import type { AssetDerived } from '../contracts';
import { derivedNode } from './ai-derived';
import { AI_BINDINGS_DATA } from './ai-types';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownNode } from './types';

export interface AiSourceBlock {
  blockId: string;
  type: string;
  path: number[];
  parentBlockId: string | null;
  from: number;
  to: number;
  node: ProseMirrorNode;
}

export interface AnchorPlacement {
  kind: 'ancestor' | 'after' | 'cellText';
  type: string;
  name?: string;
  envelopeType?: string;
}

export function sourceBlocks(document: ProseMirrorNode): Map<string, AiSourceBlock> {
  document.check();
  const issues = inspectBlockIds(document);
  if (issues.length) throw new KnowledgeMarkdownError('invalid_anchor', `AI Markdown requires valid unique block identities (${issues[0].kind} at ${issues[0].position})`);
  const blocks = new Map<string, AiSourceBlock>();
  function visit(parent: ProseMirrorNode, start: number, path: number[], parentBlockId: string | null): void {
    parent.forEach((node, offset, index) => {
      const from = start + offset;
      const childPath = [...path, index];
      const blockId = isKnowledgeBlock(node) ? node.attrs.blockId as string : null;
      if (blockId) blocks.set(blockId, { blockId, type: node.type.name, path: childPath, parentBlockId, from, to: from + node.nodeSize, node });
      if (!node.isLeaf) visit(node, from + 1, childPath, blockId ?? parentBlockId);
    });
  }
  visit(document, 0, [], null);
  return blocks;
}

const marker = (blockId: string): MarkdownNode => ({ type: 'blockAnchor', blockId });

function appendInline(node: MarkdownNode, anchors: MarkdownNode[]): void {
  (node.children ??= []).push(...anchors);
}

function appendBody(node: MarkdownNode, anchors: MarkdownNode[]): void {
  const children = node.children ??= [];
  const last = children.at(-1);
  if (last?.type === 'paragraph') appendInline(last, anchors);
  else {
    children.push({ type: 'paragraph', children: anchors });
    // A closing marker paragraph after a nested list cannot be a lazy continuation
    // of its last item. Force a real flow boundary inside the owning list item.
    if (node.type === 'listItem') node.spread = true;
  }
}

/** Decoration only: grammar/content encoding is still the standard registry pipeline. */
export function decorateAiTree(tree: MarkdownNode, blocks: ReadonlyMap<string, AiSourceBlock>, registry: BlockRegistry, assets: ReadonlyMap<string, AssetDerived>) {
  const placements = new Map<string, AnchorPlacement>();
  function visit(input: MarkdownNode): MarkdownNode[] {
    const ids = input.data?.[AI_BINDINGS_DATA] as readonly string[] | undefined;
    const data = { ...input.data };
    delete data[AI_BINDINGS_DATA];
    const node: MarkdownNode = {
      ...input, ...(input.data ? { data } : {}),
      ...(input.children ? { children: input.children.flatMap(visit) } : {}),
    };
    if (!ids?.length) return [node];
    const anchors = ids.map((id) => {
      const block = blocks.get(id);
      if (!block || placements.has(id)) throw new KnowledgeMarkdownError('invalid_anchor', `Missing or duplicate source binding: ${id}`);
      const kind = node.type === 'tableCell' && block.node.isTextblock ? 'cellText'
        : ['paragraph', 'heading', 'tableCell', 'tableRow', 'table', 'list', 'listItem', 'blockquote', 'containerDirective'].includes(node.type) ? 'ancestor' : 'after';
      placements.set(id, { kind, type: node.type, ...(node.name ? { name: node.name } : {}),
        ...(node.name === 'fob-block' ? { envelopeType: node.attributes?.type ?? undefined } : {}) });
      return marker(id);
    });
    const output: MarkdownNode[] = [node];
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'tableCell') appendInline(node, anchors);
    else if (node.type === 'tableRow') appendInline(node.children!.at(-1)!, anchors);
    else if (node.type === 'table') appendInline(node.children!.at(-1)!.children!.at(-1)!, anchors);
    else if (node.type === 'list') appendBody(node.children!.at(-1)!, anchors);
    else if (node.type === 'listItem' || node.type === 'blockquote' || node.type === 'containerDirective') appendBody(node, anchors);
    else output.push({ type: 'paragraph', children: anchors });
    for (const id of ids) {
      const block = blocks.get(id)!;
      if (registry.get(block.type)?.index.mode !== 'media') continue;
      const derived = derivedNode(id, block.node.attrs.src, assets);
      if (derived) output.push(derived);
    }
    return output;
  }
  const result = visit(tree)[0];
  if (placements.size !== blocks.size) throw new KnowledgeMarkdownError('invalid_anchor', 'A grammar codec did not bind every structural block');
  return { tree: result, placements };
}

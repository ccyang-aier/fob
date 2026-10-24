import { DOMSerializer, Fragment, Slice } from '@tiptap/pm/model';
import type { DOMOutputSpec, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import { collectBlockIds, createBlockIdAllocator, isValidBlockId } from './block-id';
import type { BlockIdOptions } from './block-id';
import { isKnowledgeBlock } from './types';

export const BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE = 'data-fob-clipboard-source';

export interface BlockPasteOptions extends BlockIdOptions {
  targetPageId: string;
  sourcePageId?: string | null;
  targetDoc?: ProseMirrorNode;
}

/** Use for both browser paste and an explicit “duplicate block” command. */
export function reidentifyPastedSlice(slice: Slice, options: BlockPasteOptions): Slice {
  const reserved = options.targetDoc ? collectBlockIds(options.targetDoc) : new Set<string>();
  slice.content.descendants((node) => {
    if (isKnowledgeBlock(node) && isValidBlockId(node.attrs.blockId)) reserved.add(node.attrs.blockId);
  });
  const allocate = createBlockIdAllocator(reserved, options.generateId);
  const crossPage = !!options.sourcePageId && options.sourcePageId !== options.targetPageId;
  function rewrite(fragment: Fragment): Fragment {
    const nodes: ProseMirrorNode[] = [];
    fragment.forEach((node) => {
      const content = node.isLeaf ? node.content : rewrite(node.content);
      nodes.push(isKnowledgeBlock(node) ? node.type.create({
        ...node.attrs,
        blockId: allocate(),
        sourceBlockId: crossPage && isValidBlockId(node.attrs.blockId) ? node.attrs.blockId : null,
      }, content, node.marks) : node.copy(content));
    });
    return Fragment.fromArray(nodes);
  }
  return new Slice(rewrite(slice.content), slice.openStart, slice.openEnd);
}

/** Carries provenance in the clipboard itself, including across windows/processes. */
export function createBlockClipboardSerializer(schema: Schema, pageId: string): DOMSerializer {
  if (!isValidBlockId(pageId)) throw new TypeError('Clipboard source requires a valid page ID');
  const serializer = DOMSerializer.fromSchema(schema);
  const source = `v1:${encodeURIComponent(pageId)}`;
  const nodes = Object.fromEntries(Object.entries(serializer.nodes).map(([name, render]) => [name, (node: ProseMirrorNode): DOMOutputSpec => {
    const output = render(node);
    if (!Array.isArray(output)) return output;
    const hasAttributes = typeof output[1] === 'object' && output[1] !== null && !Array.isArray(output[1]);
    return [output[0], { ...(hasAttributes ? output[1] : {}), [BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE]: source }, ...output.slice(hasAttributes ? 2 : 1)] as DOMOutputSpec;
  }]));
  return new DOMSerializer(nodes, serializer.marks);
}

export function readBlockClipboardSource(html: string): string | null {
  const pattern = /\bdata-fob-clipboard-source\s*=\s*["']([^"']*)["']/gi;
  let source: string | null = null;
  for (const match of html.matchAll(pattern)) {
    try {
      if (!match[1].startsWith('v1:')) return null;
      const value = decodeURIComponent(match[1].slice(3));
      if (!isValidBlockId(value) || (source !== null && source !== value)) return null;
      source = value;
    } catch { return null; }
  }
  return source;
}

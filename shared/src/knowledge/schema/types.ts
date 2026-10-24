import type { MarkSpec, Node as ProseMirrorNode, NodeSpec } from '@tiptap/pm/model';

/** Semantic mapping only. The remark pipeline owns the corresponding codecs. */
export type MarkdownMapping =
  | { readonly type: string; readonly variant?: string }
  | { readonly directive: string; readonly kind: 'container' | 'leaf' | 'text' };

export interface BlockDefinition<Name extends string = string> {
  readonly name: Name;
  readonly schema: NodeSpec;
  readonly markdown: { readonly fromMd: MarkdownMapping };
  readonly index: { readonly mode: 'text' | 'media' | 'skip' };
  readonly ai?: { readonly describe: (node: ProseMirrorNode) => string };
  readonly slash?: {
    readonly title: string;
    readonly keywords: readonly string[];
    readonly group?: 'text' | 'layout' | 'media' | 'knowledge' | 'ai';
  };
}

export interface MarkDefinition<Name extends string = string> {
  readonly name: Name;
  readonly schema: MarkSpec;
  readonly markdown: { readonly fromMd: MarkdownMapping };
}

export function defineBlock<const Name extends string>(definition: BlockDefinition<Name>): BlockDefinition<Name> {
  if (!/^[a-z][A-Za-z0-9_]*$/.test(definition.name)) {
    throw new Error(`Invalid block name: ${definition.name}`);
  }
  if (definition.schema.inline) throw new Error(`Block ${definition.name} cannot be inline`);
  if (definition.schema.attrs?.blockId || definition.schema.attrs?.sourceBlockId || definition.schema.attrs?.annotations) {
    throw new Error(`Block identity and annotation attributes are owned by the registry: ${definition.name}`);
  }
  return Object.freeze(definition);
}

/** Stable identity is attached to both root blocks and structural child blocks. */
export function isKnowledgeBlock(node: ProseMirrorNode): boolean {
  return node.type.spec.fobBlock === true;
}

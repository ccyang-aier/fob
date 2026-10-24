import type { Root } from 'mdast';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';

import type { BlockDefinition, BlockRegistry, MarkDefinition } from '../schema';
import type { AiMarkdownContext, AiMarkdownOptions, MarkdownExportOptions, MarkdownImportOptions } from './ai-types';

/** The open mdast shape also covers registry-defined directive syntax. */
export interface MarkdownNode {
  type: string;
  blockId?: string;
  children?: MarkdownNode[];
  value?: string;
  name?: string;
  attributes?: Record<string, string | null | undefined>;
  depth?: number;
  ordered?: boolean | null;
  start?: number | null;
  spread?: boolean | null;
  checked?: boolean | null;
  lang?: string | null;
  meta?: string | null;
  url?: string;
  title?: string | null;
  alt?: string | null;
  identifier?: string;
  label?: string | null;
  target?: string;
  targetBlockId?: string | null;
  embed?: boolean;
  align?: Array<'left' | 'right' | 'center' | null>;
  data?: Record<string, unknown>;
  position?: Root['position'];
}

export interface MarkdownContext {
  readonly registry: BlockRegistry;
  readonly schema: Schema;
  blockDefinition(type: string, variant?: string): BlockDefinition;
  markDefinition(type: string): MarkDefinition;
  createBlock(definition: BlockDefinition, attrs: Record<string, unknown> | null, children?: readonly ProseMirrorNode[], source?: MarkdownNode): ProseMirrorNode;
  createMark(definition: MarkDefinition, attrs?: Record<string, unknown> | null, source?: MarkdownNode): Mark;
  encodeBlock(node: ProseMirrorNode, canonical?: boolean): MarkdownNode;
  bindBlock(node: ProseMirrorNode, markdown: MarkdownNode): MarkdownNode;
  encodeInline(nodes: readonly ProseMirrorNode[], canonical?: boolean): MarkdownNode[];
  decodeBlocks(nodes: readonly MarkdownNode[]): ProseMirrorNode[];
  decodeBlock(node: MarkdownNode): ProseMirrorNode[];
  decodeInline(nodes: readonly MarkdownNode[], marks?: readonly Mark[]): ProseMirrorNode[];
  reference(identifier: string, source: MarkdownNode): MarkdownNode;
}

/** Codecs implement grammar, while the schema registry owns domain mappings. */
export interface MarkdownBlockCodec {
  encode(node: ProseMirrorNode, definition: BlockDefinition, context: MarkdownContext): MarkdownNode;
  decode(node: MarkdownNode, context: MarkdownContext): ProseMirrorNode[];
}

export interface MarkdownPipeline {
  readonly registry: BlockRegistry;
  readonly schema: Schema;
  parse(markdown: string, options?: MarkdownImportOptions): ProseMirrorNode;
  serialize(document: ProseMirrorNode, options?: MarkdownExportOptions): string;
  fromMdast(tree: Root, options?: MarkdownImportOptions): ProseMirrorNode;
  toMdast(document: ProseMirrorNode, options?: MarkdownExportOptions): Root;
  createAiContext(document: ProseMirrorNode, options?: Omit<AiMarkdownOptions, 'dialect'>): AiMarkdownContext;
}

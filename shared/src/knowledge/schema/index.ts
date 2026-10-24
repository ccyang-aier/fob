import { KNOWLEDGE_BLOCKS } from './blocks';
import { KNOWLEDGE_MARKS } from './marks';
import { BlockRegistry } from './registry';
import type { BlockDefinition, MarkDefinition } from './types';

export { KNOWLEDGE_BLOCKS } from './blocks';
export { KNOWLEDGE_MARKS } from './marks';
export { BlockRegistry } from './registry';
export { defineBlock, isKnowledgeBlock } from './types';
export type { BlockDefinition, MarkDefinition, MarkdownMapping } from './types';
export { safeKnowledgeUrl } from './urls';
export type { KnowledgeUrlPurpose } from './urls';
export { isValidBlockId, inspectBlockIds, planBlockIdRepairs, applyBlockIdRepairs, repairBlockIds } from './block-id';
export type { BlockIdOptions, BlockIdIssueKind, BlockIdIssue, BlockIdRepair } from './block-id';
export { BLOCK_CLIPBOARD_SOURCE_ATTRIBUTE, createBlockClipboardSerializer, readBlockClipboardSource, reidentifyPastedSlice } from './block-id-clipboard';
export type { BlockPasteOptions } from './block-id-clipboard';
export { blockIdPluginKey, createBlockIdRepairTransaction, createBlockIdPlugin, createBlockIdExtension } from './block-id-plugin';
export type { BlockIdPluginOptions } from './block-id-plugin';

export function createKnowledgeRegistry(additions: {
  blocks?: readonly BlockDefinition[];
  marks?: readonly MarkDefinition[];
} = {}): BlockRegistry {
  return new BlockRegistry([...KNOWLEDGE_BLOCKS, ...additions.blocks ?? []], [...KNOWLEDGE_MARKS, ...additions.marks ?? []]);
}

export function createKnowledgeExtensions(registry = createKnowledgeRegistry()) {
  return registry.createExtensions();
}

export const knowledgeSchema = createKnowledgeRegistry().createSchema();

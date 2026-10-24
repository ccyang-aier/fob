import { nanoid } from 'nanoid';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';

import { isKnowledgeBlock } from './types';

export interface BlockIdOptions { generateId?: () => string }
export type BlockIdIssueKind = 'missing' | 'invalid' | 'duplicate' | 'invalid_source';
export interface BlockIdIssue {
  kind: BlockIdIssueKind;
  position: number;
  blockType: string;
  value: unknown;
}
export interface BlockIdRepair {
  position: number;
  blockId: string;
  sourceBlockId: string | null;
  issues: readonly BlockIdIssue[];
}

export function isValidBlockId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

/** Only later occurrences are duplicate: references to the first block stay valid. */
export function inspectBlockIds(doc: ProseMirrorNode): BlockIdIssue[] {
  const issues: BlockIdIssue[] = [];
  const seen = new Set<string>();
  doc.descendants((node, position) => {
    if (!isKnowledgeBlock(node)) return;
    const value: unknown = node.attrs.blockId;
    const kind = value == null || value === '' ? 'missing'
      : !isValidBlockId(value) ? 'invalid' : seen.has(value) ? 'duplicate' : null;
    if (kind) issues.push({ kind, position, blockType: node.type.name, value });
    if (isValidBlockId(value)) seen.add(value);
    const source: unknown = node.attrs.sourceBlockId;
    if (source != null && !isValidBlockId(source)) {
      issues.push({ kind: 'invalid_source', position, blockType: node.type.name, value: source });
    }
  });
  return issues;
}

export function collectBlockIds(doc: ProseMirrorNode): Set<string> {
  const ids = new Set<string>();
  doc.descendants((node) => { if (isKnowledgeBlock(node) && isValidBlockId(node.attrs.blockId)) ids.add(node.attrs.blockId); });
  return ids;
}

/** Reserve all existing IDs before allocation, including blocks later in the document. */
export function createBlockIdAllocator(reserved: Set<string>, generateId: () => string = nanoid): () => string {
  return () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const id = generateId();
      if (!isValidBlockId(id)) throw new TypeError('Block ID generator returned an invalid ID');
      if (reserved.has(id)) continue;
      reserved.add(id);
      return id;
    }
    throw new Error('Block ID generator did not produce a unique ID');
  };
}

export function planBlockIdRepairs(doc: ProseMirrorNode, options: BlockIdOptions = {}): BlockIdRepair[] {
  const byPosition = new Map<number, BlockIdIssue[]>();
  for (const issue of inspectBlockIds(doc)) {
    const issues = byPosition.get(issue.position) ?? [];
    issues.push(issue);
    byPosition.set(issue.position, issues);
  }
  if (!byPosition.size) return [];
  const allocate = createBlockIdAllocator(collectBlockIds(doc), options.generateId);
  return [...byPosition].map(([position, issues]) => {
    const node = doc.nodeAt(position)!;
    return {
      position,
      blockId: issues.some(({ kind }) => kind !== 'invalid_source') ? allocate() : node.attrs.blockId,
      sourceBlockId: isValidBlockId(node.attrs.sourceBlockId) ? node.attrs.sourceBlockId : null,
      issues,
    };
  });
}

export function applyBlockIdRepairs<T extends Transform>(transform: T, repairs: readonly BlockIdRepair[]): T {
  for (const repair of repairs) {
    const node = transform.doc.nodeAt(repair.position)!;
    transform.setNodeMarkup(repair.position, undefined, {
      ...node.attrs, blockId: repair.blockId, sourceBlockId: repair.sourceBlockId,
    }, node.marks);
  }
  return transform;
}

/** Server/import/restore repair is not paste: every valid identity and provenance survives. */
export function repairBlockIds(doc: ProseMirrorNode, options: BlockIdOptions = {}): {
  doc: ProseMirrorNode;
  repairs: readonly BlockIdRepair[];
} {
  const repairs = planBlockIdRepairs(doc, options);
  return { doc: repairs.length ? applyBlockIdRepairs(new Transform(doc), repairs).doc : doc, repairs };
}

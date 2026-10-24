import { Mark } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { inspectBlockIds, isKnowledgeBlock } from '../schema';
import { sameValue } from '../markdown/attributes';
import { compareInline } from './inline';
import { stableSiblingIds } from './order';
import { HistoryDiffError } from './types';
import type { HistoryBlockChange, HistoryBlockLocation, HistoryChangeReason, HistoryDiffOptions } from './types';

interface Block { node: ProseMirrorNode; location: HistoryBlockLocation }
function collect(document: ProseMirrorNode | null): Map<string, Block> {
  const blocks = new Map<string, Block>();
  if (document === null) return blocks;
  try {
    if (document.type !== document.type.schema.topNodeType) throw new Error('Expected document');
    document.check();
  } catch { throw new HistoryDiffError('invalid_document'); }
  if (inspectBlockIds(document).length) throw new HistoryDiffError('invalid_block_identity');
  function visit(parent: ProseMirrorNode, start: number, parentBlockId: string | null, path: readonly number[]) {
    parent.forEach((node, offset, index) => {
      if (!isKnowledgeBlock(node)) throw new HistoryDiffError('invalid_document');
      const from = start + offset, blockId: string = node.attrs.blockId, childPath = [...path, index];
      blocks.set(blockId, { node, location: { type: node.type.name, parentBlockId, index, path: childPath, range: { from, to: from + node.nodeSize } } });
      if (!node.inlineContent && !node.isLeaf) visit(node, from + 1, blockId, childPath);
    });
  }
  visit(document, 0, null, []);
  return blocks;
}

function movedIds(before: ReadonlyMap<string, Block>, after: ReadonlyMap<string, Block>): Set<string> {
  const moved = new Set<string>();
  const siblings = new Map<string | null, { id: string; index: number }[]>();
  for (const [id, current] of after) {
    const previous = before.get(id);
    if (!previous) continue;
    if (previous.location.parentBlockId !== current.location.parentBlockId) { moved.add(id); continue; }
    const parent = current.location.parentBlockId, group = siblings.get(parent) ?? [];
    group.push({ id, index: previous.location.index });
    siblings.set(parent, group);
  }
  for (const group of siblings.values()) {
    const stable = stableSiblingIds(group);
    for (const { id } of group) if (!stable.has(id)) moved.add(id);
  }
  return moved;
}

/** Pure read-only comparison. null represents an absent version, not a fabricated blank page. */
export function compareHistoryDocuments(beforeDocument: ProseMirrorNode | null, afterDocument: ProseMirrorNode | null, options: HistoryDiffOptions = {}): readonly HistoryBlockChange[] {
  const cells = options.maxInlineComparisonCells ?? 2_000_000;
  if (!Number.isSafeInteger(cells) || cells < 0 || cells > 8_000_000) throw new HistoryDiffError('invalid_options');
  if (beforeDocument && afterDocument && beforeDocument.type.schema !== afterDocument.type.schema) throw new HistoryDiffError('schema_mismatch');
  const before = collect(beforeDocument), after = collect(afterDocument), moved = movedIds(before, after);
  const budget = { cells };
  const result: HistoryBlockChange[] = [];
  for (const [blockId, current] of after) {
    const previous = before.get(blockId);
    if (!previous) {
      result.push({ blockId, before: null, after: current.location, reasons: ['added'], attributes: [], inline: null });
      continue;
    }
    const reasons: HistoryChangeReason[] = [];
    if (moved.has(blockId)) reasons.push('moved');
    if (previous.node.type !== current.node.type) reasons.push('type');
    const attributes = [...new Set([...Object.keys(previous.node.attrs), ...Object.keys(current.node.attrs)])]
      .filter((name) => name !== 'blockId' && !sameValue(previous.node.attrs[name], current.node.attrs[name])).sort();
    if (attributes.length) reasons.push('attributes');
    if (!Mark.sameSet(previous.node.marks, current.node.marks)) reasons.push('marks');
    const inline = previous.node.inlineContent || current.node.inlineContent
      ? compareInline(previous.node, previous.location.range.from, current.node, current.location.range.from, budget) : null;
    if (inline?.changes.length) reasons.push('inline');
    if (reasons.length) result.push({ blockId, before: previous.location, after: current.location, reasons, attributes,
      inline: inline?.changes.length ? inline : null });
  }
  for (const [blockId, previous] of before) {
    if (!after.has(blockId)) result.push({ blockId, before: previous.location, after: null, reasons: ['removed'], attributes: [], inline: null });
  }
  return result;
}

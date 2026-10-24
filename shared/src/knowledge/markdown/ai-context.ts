import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { readPageInputSchema } from '../contracts';
import type { BlockRegistry } from '../schema';
import { sameValue } from './attributes';
import { validateDerivedAssets } from './ai-derived';
import { nodeRange, occurrenceRange, scanAiTree, stripAiProjection } from './ai-scan';
import type { AnchorOccurrence } from './ai-scan';
import { decorateAiTree, sourceBlocks } from './ai-tree';
import type { AnchorPlacement } from './ai-tree';
import type { AiBlockBinding, AiBlockRead, AiMarkdownContext, AiMarkdownOptions, MarkdownRange } from './ai-types';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownNode } from './types';

export interface AiPipelineBridge {
  owner: object;
  registry: BlockRegistry;
  toTree(document: ProseMirrorNode): MarkdownNode;
  stringify(tree: MarkdownNode): string;
  parse(source: string): MarkdownNode;
  decode(tree: MarkdownNode): ProseMirrorNode;
}

interface ContextState {
  owner: object;
  document: unknown;
  anchors: ReadonlyMap<string, { path: readonly number[]; placement: AnchorPlacement }>;
  derived: readonly { path: readonly number[]; attributes: MarkdownNode['attributes'] }[];
}
const trustedContexts = new WeakMap<AiMarkdownContext, ContextState>();

function frozenRange(range: MarkdownRange): MarkdownRange { return Object.freeze(range); }

function assertAtBlockEnd(occurrence: AnchorOccurrence, placement: AnchorPlacement): void {
  const carrier = occurrence.ancestors.at(-1);
  const children = carrier?.children ?? [];
  const index = occurrence.path.at(-1)!;
  const nonSource = (node: MarkdownNode) => node.type === 'blockAnchor' || (node.type === 'text' && /^ *$/.test(node.value ?? ''));
  if (children.slice(index + 1).some((node) => !nonSource(node))
    || (placement.kind === 'after' && children.some((node) => !nonSource(node)))) {
    throw new KnowledgeMarkdownError('invalid_anchor', 'AI anchors must remain at the end of their exact block carrier', occurrence.node);
  }
}

export function createAiContext(document: ProseMirrorNode, options: Omit<AiMarkdownOptions, 'dialect'>, bridge: AiPipelineBridge) {
  const source = sourceBlocks(document);
  const assets = validateDerivedAssets(options.derivedByAsset);
  const decorated = decorateAiTree(bridge.toTree(document), source, bridge.registry, assets);
  const markdown = bridge.stringify(decorated.tree);
  const parsed = bridge.parse(markdown);
  const scan = scanAiTree(parsed);
  if (scan.anchors.size !== source.size) throw new KnowledgeMarkdownError('invalid_anchor', 'AI serialization did not retain one anchor per block');
  const restored = bridge.decode(stripAiProjection(parsed));
  if (!sameValue(restored.toJSON(), document.toJSON())) throw new KnowledgeMarkdownError('lossy_serialization', 'AI annotation changed original document semantics');

  const derivedRanges = new Map<string, MarkdownRange[]>();
  for (const entry of scan.derived) {
    const id = entry.node.attributes?.for ?? '';
    if (!source.has(id) || derivedRanges.has(id)) throw new KnowledgeMarkdownError('invalid_derived', 'Derived context has an invalid source binding', entry.node);
    derivedRanges.set(id, [frozenRange(nodeRange(entry.node))]);
  }
  const anchors = new Map<string, { path: readonly number[]; placement: AnchorPlacement }>();
  const blocks: readonly AiBlockBinding[] = Object.freeze([...source.values()].map((block) => {
    const occurrence = scan.anchors.get(block.blockId);
    const placement = decorated.placements.get(block.blockId)!;
    if (!occurrence) throw new KnowledgeMarkdownError('invalid_anchor', `Missing AI anchor: ${block.blockId}`);
    assertAtBlockEnd(occurrence, placement);
    anchors.set(block.blockId, { path: [...occurrence.path], placement });
    const range = frozenRange(occurrenceRange(occurrence, placement));
    const derived = Object.freeze(derivedRanges.get(block.blockId) ?? []);
    return Object.freeze({
      blockId: block.blockId, type: block.type, parentBlockId: block.parentBlockId, path: Object.freeze([...block.path]),
      pmRange: frozenRange({ from: block.from, to: block.to }), markdownRange: range,
      contextRange: frozenRange({ from: range.from, to: Math.max(range.to, ...derived.map((item) => item.to)) }),
      anchorRange: frozenRange(nodeRange(occurrence.node)), derivedRanges: derived,
    });
  }));
  const knownIds = new Set(source.keys());
  const context: AiMarkdownContext = Object.freeze({
    markdown, blocks,
    read(range?: readonly string[]): readonly AiBlockRead[] {
      let ids: string[] | undefined;
      try { ids = readPageInputSchema.shape.range.parse(range); }
      catch (cause) { throw new KnowledgeMarkdownError('invalid_range', 'Invalid read_page anchor range', undefined, { cause }); }
      if (ids && (new Set(ids).size !== ids.length || ids.some((id) => !knownIds.has(id)))) {
        throw new KnowledgeMarkdownError('invalid_range', 'Anchor range contains a duplicate or unknown block ID');
      }
      const requested = ids ? new Set(ids) : null;
      return Object.freeze(blocks.filter((block) => !requested || requested.has(block.blockId)).map((binding) => Object.freeze({
        binding, markdown: markdown.slice(binding.contextRange.from, binding.contextRange.to),
        source: 'authoritative-snapshot' as const, readOnly: true as const,
      })));
    },
  });
  trustedContexts.set(context, {
    owner: bridge.owner, document: JSON.parse(JSON.stringify(document.toJSON())), anchors,
    derived: scan.derived.map(({ node, path }) => ({ path: [...path], attributes: { ...node.attributes } })),
  });
  return { context, tree: decorated.tree };
}

/** This is a verified read projection, not a parser for write proposals. */
export function decodeAiProjection(tree: MarkdownNode, context: AiMarkdownContext, bridge: AiPipelineBridge): ProseMirrorNode {
  const expected = trustedContexts.get(context);
  if (!expected || expected.owner !== bridge.owner) throw new KnowledgeMarkdownError('untrusted_context', 'AI Markdown requires a context issued by this pipeline from authoritative source');
  const scan = scanAiTree(tree);
  if (scan.anchors.size !== expected.anchors.size) throw new KnowledgeMarkdownError('invalid_anchor', 'AI anchor set is incomplete or contains extra anchors');
  for (const [id, occurrence] of scan.anchors) {
    const binding = expected.anchors.get(id);
    if (!binding || !sameValue(binding.path, occurrence.path)) throw new KnowledgeMarkdownError('invalid_anchor', `AI anchor moved or was forged: ${id}`, occurrence.node);
    assertAtBlockEnd(occurrence, binding.placement);
    occurrenceRange(occurrence, binding.placement);
  }
  if (scan.derived.length !== expected.derived.length) throw new KnowledgeMarkdownError('invalid_derived', 'Derived context boundaries were added or removed');
  for (let index = 0; index < scan.derived.length; index++) {
    const actual = scan.derived[index];
    const original = expected.derived[index];
    if (!sameValue(actual.path, original.path) || !sameValue(actual.node.attributes, original.attributes)) {
      throw new KnowledgeMarkdownError('invalid_derived', 'Derived context was moved or rebound to a different source', actual.node);
    }
  }
  const document = bridge.decode(stripAiProjection(tree));
  if (!sameValue(expected.document, document.toJSON())) {
    throw new KnowledgeMarkdownError('context_mismatch', 'Original source changed; an AI read projection is not an editable write payload');
  }
  return document;
}

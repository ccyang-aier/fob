import type { Root } from 'mdast';
import type { Mark, Node as ProseMirrorNode, Schema } from '@tiptap/pm/model';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkMath from 'remark-math';

import { createKnowledgeRegistry, knowledgeSchema } from '../schema';
import type { BlockDefinition, BlockRegistry, MarkDefinition } from '../schema';
import { remarkKnowledgeBlockAnchors } from './ai-anchors';
import { createAiContext as buildAiContext, decodeAiProjection } from './ai-context';
import type { AiPipelineBridge } from './ai-context';
import { AI_BINDINGS_DATA, AI_DERIVED_DIRECTIVE } from './ai-types';
import { assertKnownAttributes, sameValue } from './attributes';
import { childNodes, STANDARD_BLOCK_CODECS } from './block-codecs';
import { BLOCK_DIRECTIVE, BOUNDARY_DIRECTIVE, decodeDirectiveBlock, encodeDirectiveBlock, META_DIRECTIVE, RESERVED_DIRECTIVES } from './directives';
import { KnowledgeMarkdownError, unsupported } from './errors';
import { decodeInline, encodeInline } from './inline';
import { applyMetadata, metadataDifferences, metadataNode } from './metadata';
import type { MarkdownBlockCodec, MarkdownContext, MarkdownNode, MarkdownPipeline } from './types';
import { remarkKnowledgeWikiLinks } from './wiki';

export interface MarkdownPipelineOptions {
  registry?: BlockRegistry;
  schema?: Schema;
  /** Extra grammar codecs. Domain names/mappings still come exclusively from the registry. */
  codecs?: Readonly<Record<string, MarkdownBlockCodec>>;
}

const mappingKey = (type: string, variant = '') => `${type}:${variant}`;
const referenceKey = (identifier: string) => identifier.replace(/[\t\n\r ]+/g, ' ').trim().toUpperCase();

function separateContainers(node: MarkdownNode): MarkdownNode {
  if (!node.children) return node;
  const children: MarkdownNode[] = [];
  for (const child of node.children.map(separateContainers)) {
    if (child.type === children.at(-1)?.type && (child.type === 'list' || child.type === 'blockquote')) {
      children.push({ type: 'leafDirective', name: BOUNDARY_DIRECTIVE, attributes: {}, children: [] });
    }
    children.push(child);
  }
  return { ...node, children };
}

export function createMarkdownPipeline(options: MarkdownPipelineOptions = {}): MarkdownPipeline {
  const registry = options.registry ?? createKnowledgeRegistry();
  const schema = options.schema ?? (options.registry ? registry.createSchema() : knowledgeSchema);
  const codecs = { ...STANDARD_BLOCK_CODECS, ...options.codecs };
  const blocks = new Map<string, BlockDefinition>();
  const marks = new Map<string, MarkDefinition>();
  const directives = new Map<string, BlockDefinition>();
  const usedDirectives = new Set<string>();
  for (const definition of [...registry.getDefinitions(), ...registry.getMarkDefinitions()]) {
    const mapping = definition.markdown.fromMd;
    if ('directive' in mapping) {
      const key = `${mapping.kind}Directive:${mapping.directive}`;
      if (RESERVED_DIRECTIVES.has(mapping.directive) || mapping.directive === AI_DERIVED_DIRECTIVE || usedDirectives.has(key)) {
        throw new KnowledgeMarkdownError('ambiguous_mapping', `Duplicate or reserved Markdown directive: ${mapping.directive}`);
      }
      usedDirectives.add(key);
      if (registry.get(definition.name)) directives.set(key, definition as BlockDefinition);
    } else {
      const target = registry.get(definition.name) ? blocks : marks;
      const key = mappingKey(mapping.type, mapping.variant);
      if (target.has(key)) throw new KnowledgeMarkdownError('ambiguous_mapping', `Duplicate Markdown mapping: ${key}`);
      // The two maps share a minimal structural interface but retain their public types.
      if (registry.get(definition.name)) blocks.set(key, definition as BlockDefinition);
      else marks.set(key, definition as MarkDefinition);
    }
  }
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)
    .use(remarkMath).use(remarkKnowledgeWikiLinks).use(remarkStringify, { bullet: '-', fences: true, listItemIndent: 'one', emphasis: '*', strong: '*', quote: "'" });
  const aiProcessor = processor().use(remarkGfm, { tableCellPadding: false, tablePipeAlign: false }).use(remarkKnowledgeBlockAnchors);
  const stringify = (tree: MarkdownNode) => processor.stringify(tree as Root);
  const parseTree = (markdown: string) => processor.parse(markdown) as MarkdownNode;

  function context(tree?: MarkdownNode, bind = false): MarkdownContext {
    const references = new Map<string, MarkdownNode>();
    const gather = (node: MarkdownNode) => {
      if (node.type === 'definition' && !references.has(referenceKey(node.identifier ?? ''))) references.set(referenceKey(node.identifier ?? ''), node);
      node.children?.forEach(gather);
    };
    if (tree) gather(tree);
    const ctx: MarkdownContext = {
      registry, schema,
      blockDefinition(type, variant) {
        const definition = blocks.get(mappingKey(type, variant));
        if (!definition) throw new KnowledgeMarkdownError('unsupported_node', `No registered block for Markdown ${mappingKey(type, variant)}`);
        return definition;
      },
      markDefinition(type) {
        const definition = marks.get(mappingKey(type));
        if (!definition) throw new KnowledgeMarkdownError('unsupported_mark', `No registered mark for Markdown ${type}`);
        return definition;
      },
      createBlock(definition, attrs, children = [], source) {
        const type = schema.nodes[definition.name];
        if (!type) throw new KnowledgeMarkdownError('invalid_content', `Schema is missing block ${definition.name}`, source);
        assertKnownAttributes(type, attrs ?? {}, source);
        try { return type.createChecked(attrs, children); }
        catch (cause) { throw new KnowledgeMarkdownError('invalid_content', `Invalid ${definition.name} content or attributes`, source, { cause }); }
      },
      createMark(definition, attrs, source): Mark {
        const type = schema.marks[definition.name];
        if (!type) throw new KnowledgeMarkdownError('unsupported_mark', `Schema is missing mark ${definition.name}`, source);
        assertKnownAttributes(type, attrs ?? {}, source);
        try { const mark = type.create(attrs); schema.text('x', [mark]).check(); return mark; }
        catch (cause) { throw new KnowledgeMarkdownError('invalid_attribute', `Invalid ${definition.name} mark attributes`, source, { cause }); }
      },
      bindBlock(node, markdown) {
        if (!bind) return markdown;
        const previous = (markdown.data?.[AI_BINDINGS_DATA] ?? []) as readonly string[];
        return { ...markdown, data: { ...markdown.data, [AI_BINDINGS_DATA]: [...new Set([...previous, node.attrs.blockId as string])] } };
      },
      encodeBlock(node, canonical = false) {
        const definition = registry.get(node.type.name);
        if (!definition) throw new KnowledgeMarkdownError('unsupported_node', `Unregistered block: ${node.type.name}`);
        const mapping = definition.markdown.fromMd;
        if (canonical || 'directive' in mapping) return ctx.bindBlock(node, encodeDirectiveBlock(node, definition, ctx, canonical));
        const codec = codecs[mapping.type];
        if (!codec) throw new KnowledgeMarkdownError('unsupported_node', `No grammar codec for Markdown ${mapping.type}`);
        return ctx.bindBlock(node, codec.encode(node, definition, ctx));
      },
      encodeInline: (nodes, canonical) => encodeInline(nodes, ctx, canonical),
      decodeInline: (nodes, activeMarks) => decodeInline(nodes, ctx, activeMarks),
      decodeBlock(node) {
        if (node.type === 'containerDirective' || node.type === 'leafDirective') {
          const canonical = node.name === BLOCK_DIRECTIVE;
          const definition = canonical ? registry.get(node.attributes?.type ?? '') : directives.get(`${node.type}:${node.name}`);
          if (!definition) throw new KnowledgeMarkdownError('unknown_directive', `Unknown block directive: ${node.name}`, node);
          return [decodeDirectiveBlock(node, definition, ctx, canonical)];
        }
        const codec = codecs[node.type];
        if (!codec) return unsupported(node);
        return codec.decode(node, ctx);
      },
      decodeBlocks(nodes) {
        const result: ProseMirrorNode[] = [];
        let metadata: MarkdownNode | undefined;
        for (const node of nodes) {
          if (node.type === 'definition') continue;
          if (node.type === 'leafDirective' && node.name === META_DIRECTIVE) {
            if (metadata) throw new KnowledgeMarkdownError('invalid_metadata', 'Consecutive metadata directives', node);
            metadata = node; continue;
          }
          if (node.type === 'leafDirective' && node.name === BOUNDARY_DIRECTIVE) {
            if (metadata || Object.keys(node.attributes ?? {}).length || node.children?.length) {
              throw new KnowledgeMarkdownError('invalid_metadata', 'Invalid block boundary', node);
            }
            continue;
          }
          const decoded = ctx.decodeBlock(node);
          if (metadata) {
            if (decoded.length !== 1) throw new KnowledgeMarkdownError('invalid_metadata', 'Metadata requires exactly one following block', metadata);
            result.push(applyMetadata(decoded[0], metadata, ctx)); metadata = undefined;
          } else result.push(...decoded);
        }
        if (metadata) throw new KnowledgeMarkdownError('invalid_metadata', 'Metadata has no following block', metadata);
        return result;
      },
      reference(identifier, source) {
        const definition = references.get(referenceKey(identifier));
        if (!definition) throw new KnowledgeMarkdownError('unresolved_reference', `Unknown Markdown reference: ${identifier}`, source);
        return definition;
      },
    };
    return ctx;
  }

  function fromTree(tree: MarkdownNode): ProseMirrorNode {
    if (tree.type !== 'root') throw new KnowledgeMarkdownError('invalid_content', 'Expected a Markdown root', tree);
    const ctx = context(tree);
    const nodes = ctx.decodeBlocks(tree.children ?? []);
    if (!nodes.length) nodes.push(ctx.createBlock(ctx.blockDefinition('paragraph'), null, []));
    try { const doc = schema.topNodeType.createChecked(null, nodes); doc.check(); return doc; }
    catch (cause) { throw new KnowledgeMarkdownError('invalid_content', 'Markdown does not form a valid knowledge document', tree, { cause }); }
  }

  function losslessBlock(node: ProseMirrorNode, ctx: MarkdownContext): MarkdownNode[] {
    const preferred = separateContainers(ctx.encodeBlock(node));
    let differences;
    try {
      const restored = fromTree(parseTree(stringify({ type: 'root', children: [preferred] })));
      differences = restored.childCount === 1 ? metadataDifferences(node, restored.firstChild!) : null;
    } catch { differences = null; }
    if (differences !== null) return [...(differences.length ? [metadataNode(differences)] : []), preferred];
    return [ctx.encodeBlock(node, true)];
  }

  function toTree(document: ProseMirrorNode, bind = false): Root {
    document.check();
    if (document.type.name !== schema.topNodeType.name) throw new KnowledgeMarkdownError('invalid_content', 'Expected a knowledge document');
    const ctx = context(undefined, bind);
    let tree = separateContainers({ type: 'root', children: childNodes(document).flatMap((node) => losslessBlock(node, ctx)) });
    const verifies = (candidate: MarkdownNode) => {
      try { return sameValue(document.toJSON(), fromTree(parseTree(stringify(candidate))).toJSON()); }
      catch { return false; }
    };
    // CommonMark can coalesce adjacent constructs. A structural fallback is still
    // Markdown directives with independently editable children, never document JSON.
    if (!verifies(tree)) tree = { type: 'root', children: childNodes(document).map((node) => ctx.encodeBlock(node, true)) };
    if (!verifies(tree)) throw new KnowledgeMarkdownError('lossy_serialization', 'The document cannot be serialized without semantic loss');
    return tree as Root;
  }

  const aiBridge: AiPipelineBridge = {
    owner: {}, registry, toTree: (document) => toTree(document, true) as MarkdownNode,
    stringify: (tree) => aiProcessor.stringify(tree as Root),
    parse: (source) => aiProcessor.parse(source) as MarkdownNode,
    decode: fromTree,
  };

  return {
    registry, schema,
    parse: (markdown, options) => options?.dialect === 'ai'
      ? decodeAiProjection(aiBridge.parse(markdown), options.context, aiBridge) : fromTree(parseTree(markdown)),
    serialize: (document, options) => options?.dialect === 'ai'
      ? buildAiContext(document, options, aiBridge).context.markdown : stringify(toTree(document) as MarkdownNode),
    fromMdast: (tree, options) => options?.dialect === 'ai'
      ? decodeAiProjection(aiBridge.parse(aiBridge.stringify(tree as MarkdownNode)), options.context, aiBridge) : fromTree(tree as MarkdownNode),
    toMdast: (document, options) => options?.dialect === 'ai'
      ? buildAiContext(document, options, aiBridge).tree as Root : toTree(document),
    createAiContext: (document, options = {}) => buildAiContext(document, options, aiBridge).context,
  };
}

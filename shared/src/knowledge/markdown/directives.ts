import type { AttributeSpec, Mark, Node as ProseMirrorNode } from '@tiptap/pm/model';

import type { BlockDefinition, MarkDefinition } from '../schema';
import { decodeAttributes, encodeAttributes, sameValue, TYPED_ATTRIBUTES } from './attributes';
import { childNodes } from './block-codecs';
import { KnowledgeMarkdownError } from './errors';
import type { MarkdownContext, MarkdownNode } from './types';

export const BLOCK_DIRECTIVE = 'fob-block';
export const INLINE_DIRECTIVE = 'fob-inline';
export const TEXT_DIRECTIVE = 'fob-text';
export const MARK_DIRECTIVE = 'fob-mark';
export const META_DIRECTIVE = 'fob-meta';
export const BOUNDARY_DIRECTIVE = 'fob-boundary';
export const MARKS_ATTRIBUTE = 'fob-marks';
export const RESERVED_DIRECTIVES = new Set([BLOCK_DIRECTIVE, INLINE_DIRECTIVE, TEXT_DIRECTIVE, MARK_DIRECTIVE, META_DIRECTIVE, BOUNDARY_DIRECTIVE]);

function envelope(type: string, attrs: Readonly<Record<string, unknown>>, specs: Readonly<Record<string, AttributeSpec>> = {}): Record<string, string> {
  const values = Object.fromEntries(Object.entries(attrs).filter(([key, value]) => !Object.hasOwn(specs[key] ?? {}, 'default') || !sameValue(value, specs[key].default)));
  return { type, ...(Object.keys(values).length ? { [TYPED_ATTRIBUTES]: JSON.stringify(values) } : {}) };
}

export function encodeDirectiveBlock(node: ProseMirrorNode, definition: BlockDefinition, context: MarkdownContext, canonical: boolean): MarkdownNode {
  const mapping = definition.markdown.fromMd;
  const mapped = !canonical && 'directive' in mapping;
  const type = mapped ? `${mapping.kind}Directive` : node.isLeaf ? 'leafDirective' : 'containerDirective';
  return {
    type, name: mapped ? mapping.directive : BLOCK_DIRECTIVE,
    attributes: {
      ...(mapped ? encodeAttributes(node.attrs, node.type.spec.attrs) : envelope(node.type.name, node.attrs, node.type.spec.attrs)),
      ...(node.marks.length ? { [MARKS_ATTRIBUTE]: JSON.stringify(node.marks.map((mark) => mark.toJSON())) } : {}),
    },
    children: node.isLeaf ? [] : node.inlineContent
      ? [{ type: 'paragraph', children: context.encodeInline(childNodes(node), canonical) }]
      : childNodes(node).map((child) => context.encodeBlock(child, canonical)),
  };
}

export function decodeDirectiveBlock(node: MarkdownNode, definition: BlockDefinition, context: MarkdownContext, canonical: boolean): ProseMirrorNode {
  const type = context.schema.nodes[definition.name];
  const attrs = decodeAttributes(node, type, canonical ? ['type', MARKS_ATTRIBUTE] : [MARKS_ATTRIBUTE]);
  let children: ProseMirrorNode[] = [];
  const content = node.children ?? [];
  if (content.some((child) => child.data?.directiveLabel)) {
    throw new KnowledgeMarkdownError('invalid_attribute', 'Container directive labels are not schema attributes; use an explicit title attribute or body', node);
  }
  if (type.isLeaf) {
    if (content.length) throw new KnowledgeMarkdownError('invalid_content', `Leaf block ${type.name} cannot contain a directive label`, node);
  } else if (type.inlineContent) {
    if (content.length > 1 || (content.length === 1 && content[0].type !== 'paragraph')) {
      throw new KnowledgeMarkdownError('invalid_content', `Text block ${type.name} requires one inline paragraph`, node);
    }
    children = context.decodeInline(content[0]?.children ?? []);
  } else children = context.decodeBlocks(content);
  const result = context.createBlock(definition, attrs, children, node);
  if (!Object.hasOwn(node.attributes ?? {}, MARKS_ATTRIBUTE)) return result;
  let marks: unknown;
  try { marks = JSON.parse(node.attributes![MARKS_ATTRIBUTE] ?? ''); }
  catch (cause) { throw new KnowledgeMarkdownError('invalid_attribute', 'Invalid block marks JSON', node, { cause }); }
  return result.mark(decodeMarks(marks, context, node));
}

export function decodeMarks(value: unknown, context: MarkdownContext, source: MarkdownNode): Mark[] {
  if (!Array.isArray(value)) throw new KnowledgeMarkdownError('invalid_attribute', 'Marks must be an array', source);
  return value.map((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new KnowledgeMarkdownError('invalid_attribute', 'Invalid mark metadata', source);
    const mark = entry as { type?: unknown; attrs?: unknown };
    if (Object.keys(mark).some((key) => key !== 'type' && key !== 'attrs') || typeof mark.type !== 'string'
      || (mark.attrs !== undefined && (!mark.attrs || typeof mark.attrs !== 'object' || Array.isArray(mark.attrs)))) {
      throw new KnowledgeMarkdownError('invalid_attribute', 'Invalid mark metadata fields', source);
    }
    const definition = context.registry.getMark(mark.type);
    if (!definition) throw new KnowledgeMarkdownError('unsupported_mark', `Unknown mark: ${mark.type}`, source);
    return context.createMark(definition, mark.attrs as Record<string, unknown> | undefined, source);
  });
}

export function encodeDirectiveMark(mark: Mark, definition: MarkDefinition, children: MarkdownNode[], canonical: boolean): MarkdownNode {
  const mapping = definition.markdown.fromMd;
  const mapped = !canonical && 'directive' in mapping;
  return {
    type: 'textDirective', name: mapped ? mapping.directive : MARK_DIRECTIVE,
    attributes: mapped ? encodeAttributes(mark.attrs, mark.type.spec.attrs) : envelope(mark.type.name, mark.attrs, mark.type.spec.attrs), children,
  };
}

export function encodeInlineEnvelope(node: ProseMirrorNode): MarkdownNode {
  return { type: 'textDirective', name: INLINE_DIRECTIVE, attributes: envelope(node.type.name, node.attrs, node.type.spec.attrs), children: [] };
}

export function decodeInlineEnvelope(node: MarkdownNode, context: MarkdownContext): ProseMirrorNode {
  const name = node.attributes?.type;
  const type = name ? context.schema.nodes[name] : undefined;
  if (!type?.isInline || type.isText || (node.children?.length ?? 0) > 0) {
    throw new KnowledgeMarkdownError('invalid_content', 'Inline envelope requires a known inline atom without children', node);
  }
  try {
    return type.createChecked(decodeAttributes(node, type, ['type']));
  } catch (cause) {
    if (cause instanceof KnowledgeMarkdownError) throw cause;
    throw new KnowledgeMarkdownError('invalid_attribute', `Invalid inline ${type.name} attributes`, node, { cause });
  }
}

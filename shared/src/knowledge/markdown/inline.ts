import { Mark } from '@tiptap/pm/model';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { decodeAttributes } from './attributes';
import { decodeInlineEnvelope, encodeDirectiveMark, encodeInlineEnvelope, INLINE_DIRECTIVE, MARK_DIRECTIVE, TEXT_DIRECTIVE } from './directives';
import { KnowledgeMarkdownError, unsupported } from './errors';
import type { MarkdownContext, MarkdownNode } from './types';

function encodeMark(mark: Mark, children: MarkdownNode[], context: MarkdownContext, canonical: boolean): MarkdownNode {
  const definition = context.registry.getMark(mark.type.name);
  if (!definition) throw new KnowledgeMarkdownError('unsupported_mark', `Unregistered mark: ${mark.type.name}`);
  const mapping = definition.markdown.fromMd;
  if (canonical || 'directive' in mapping) return encodeDirectiveMark(mark, definition, children, canonical);
  if (mapping.type === 'inlineCode') {
    return children.length === 1 && children[0].type === 'text'
      ? { type: 'inlineCode', value: children[0].value }
      : encodeDirectiveMark(mark, definition, children, true);
  }
  if (mapping.type === 'link') return { type: 'link', url: mark.attrs.href, title: mark.attrs.title, children };
  if (['strong', 'emphasis', 'delete'].includes(mapping.type)) return { type: mapping.type, children };
  throw new KnowledgeMarkdownError('unsupported_mark', `No Markdown mark codec for ${mapping.type}`);
}

function inlineAtom(node: ProseMirrorNode, canonical: boolean): MarkdownNode {
  if (node.isText) return canonical && /(^\s|\s$|[\u0000-\u001f\u007f\\\[\]:*_`~<>!$#|{}=\-])/.test(node.text!)
    ? { type: 'textDirective', name: TEXT_DIRECTIVE, attributes: { value: JSON.stringify(node.text!) }, children: [] }
    : { type: 'text', value: node.text! };
  if (canonical) return encodeInlineEnvelope(node);
  // These three are schema primitives, not separately registered block definitions.
  if (node.type.name === 'hardBreak') return { type: 'break' };
  if (node.type.name === 'inlineMath') return { type: 'inlineMath', value: node.attrs.latex };
  if (node.type.name === 'wikiLink') return { type: 'wikiLink', target: node.attrs.target, label: node.attrs.label, targetBlockId: node.attrs.targetBlockId };
  throw new KnowledgeMarkdownError('unsupported_node', `No inline codec for ${node.type.name}`);
}

/** A mark stack groups adjacent runs and preserves overlapping annotation identities. */
export function encodeInline(nodes: readonly ProseMirrorNode[], context: MarkdownContext, canonical = false): MarkdownNode[] {
  const root: MarkdownNode[] = [];
  const stack: Array<{ mark: Mark; children: MarkdownNode[] }> = [];
  const current = () => stack.at(-1)?.children ?? root;
  const close = () => { const frame = stack.pop()!; current().push(encodeMark(frame.mark, frame.children, context, canonical)); };
  for (const node of nodes) {
    let shared = 0;
    while (shared < stack.length && shared < node.marks.length && stack[shared].mark.eq(node.marks[shared])) shared++;
    while (stack.length > shared) close();
    for (const mark of node.marks.slice(shared)) stack.push({ mark, children: [] });
    current().push(inlineAtom(node, canonical));
  }
  while (stack.length) close();
  return root;
}

function withMark(marks: readonly Mark[], mark: Mark, node: MarkdownNode): readonly Mark[] {
  if (marks.some((existing) => existing.eq(mark))) return marks;
  if (marks.some((existing) => existing.type.excludes(mark.type) || mark.type.excludes(existing.type))) {
    throw new KnowledgeMarkdownError('invalid_content', `Conflicting Markdown mark: ${mark.type.name}`, node);
  }
  return Mark.setFrom([...marks, mark]);
}

export function decodeInline(nodes: readonly MarkdownNode[], context: MarkdownContext, marks: readonly Mark[] = []): ProseMirrorNode[] {
  const result: ProseMirrorNode[] = [];
  for (const node of nodes) {
    if (node.type === 'text') {
      if (node.value) result.push(context.schema.text(node.value, marks));
    } else if (node.type === 'break') result.push(context.schema.nodes.hardBreak.create(null, null, marks));
    else if (node.type === 'inlineMath') result.push(context.schema.nodes.inlineMath.create({ latex: node.value ?? '' }, null, marks));
    else if (node.type === 'wikiLink') {
      if (node.embed) throw new KnowledgeMarkdownError('unsupported_node', 'Wiki embeds require vault asset/page resolution before body import', node);
      result.push(context.schema.nodes.wikiLink.create({ target: node.target, label: node.label, targetBlockId: node.targetBlockId ?? null }, null, marks));
    } else if (node.type === 'textDirective') {
      if (node.name === TEXT_DIRECTIVE) {
        if (Object.keys(node.attributes ?? {}).some((key) => key !== 'value') || node.attributes?.value === undefined || node.children?.length) {
          throw new KnowledgeMarkdownError('invalid_attribute', 'Text envelope requires only a value attribute', node);
        }
        let value: unknown;
        try { value = JSON.parse(node.attributes.value ?? ''); }
        catch (cause) { throw new KnowledgeMarkdownError('invalid_attribute', 'Text envelope value must be a JSON string', node, { cause }); }
        if (typeof value !== 'string') throw new KnowledgeMarkdownError('invalid_attribute', 'Text envelope value must be a JSON string', node);
        if (value) result.push(context.schema.text(value, marks));
      } else if (node.name === INLINE_DIRECTIVE) result.push(decodeInlineEnvelope(node, context).mark(marks));
      else {
        const canonical = node.name === MARK_DIRECTIVE;
        const definition = canonical ? context.registry.getMark(node.attributes?.type ?? '')
          : context.registry.getMarkDefinitions().find(({ markdown }) => 'directive' in markdown.fromMd && markdown.fromMd.kind === 'text' && markdown.fromMd.directive === node.name);
        if (!definition) throw new KnowledgeMarkdownError('unknown_directive', `Unknown mark directive: ${node.name}`, node);
        const mark = context.createMark(definition, decodeAttributes(node, context.schema.marks[definition.name], canonical ? ['type'] : []), node);
        result.push(...decodeInline(node.children ?? [], context, withMark(marks, mark, node)));
      }
    } else if (node.type === 'inlineCode') {
      const mark = context.createMark(context.markDefinition('inlineCode'), null, node);
      if (node.value) result.push(context.schema.text(node.value, withMark(marks, mark, node)));
    } else if (['strong', 'emphasis', 'delete', 'link', 'linkReference'].includes(node.type)) {
      const reference = node.type === 'linkReference' ? context.reference(node.identifier ?? '', node) : node;
      const kind = node.type === 'linkReference' ? 'link' : node.type;
      const mark = context.createMark(context.markDefinition(kind), kind === 'link' ? { href: reference.url ?? '', title: reference.title ?? null } : null, node);
      result.push(...decodeInline(node.children ?? [], context, withMark(marks, mark, node)));
    } else unsupported(node);
  }
  return result;
}

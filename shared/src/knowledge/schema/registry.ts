import { getSchema, Mark, Node } from '@tiptap/core';
import type { Attributes, Extensions } from '@tiptap/core';
import type { DOMOutputSpec, Mark as ProseMirrorMark, MarkSpec, Node as ProseMirrorNode, NodeSpec, ParseRule, Schema } from '@tiptap/pm/model';

import { nullableString, stringAttribute } from './attributes';
import { nodeAnnotationsAttribute } from './annotations';
import { defineBlock } from './types';
import type { BlockDefinition, MarkDefinition } from './types';

const CORE_NODES: Readonly<Record<string, NodeSpec>> = {
  doc: { content: 'block+' },
  text: { group: 'inline' },
  hardBreak: { inline: true, group: 'inline', selectable: false, linebreakReplacement: true, parseDOM: [{ tag: 'br' }], toDOM: () => ['br'] },
  inlineMath: { inline: true, group: 'inline', atom: true, attrs: { latex: stringAttribute }, toDOM: (node) => ['span', { 'data-inline-math': node.attrs.latex }, node.attrs.latex] },
  wikiLink: { inline: true, group: 'inline', atom: true, attrs: { knowledgeBaseId: nullableString, pageId: nullableString, target: stringAttribute, label: nullableString, targetBlockId: nullableString }, toDOM: (node) => ['span', { 'data-wiki-link': node.attrs.target }, node.attrs.label || node.attrs.target] },
};

function schemaAttributes(attrs: NodeSpec['attrs']): Attributes {
  return Object.fromEntries(Object.entries(attrs ?? {}).map(([name, spec]) => [name, {
    ...spec,
    isRequired: !Object.hasOwn(spec, 'default'),
    rendered: false,
    // Parse rules already read semantic HTML and our serialized attributes.
    parseHTML: () => null,
  }]));
}

/** Serializable HTML metadata preserves attrs without teaching each view about identity. */
function withSerializedAttributes(name: string, spec: NodeSpec | MarkSpec, kind: 'node' | 'mark'): NodeSpec | MarkSpec {
  const marker = `data-fob-${kind}`;
  const attrNames = Object.keys(spec.attrs ?? {});
  const parseDOM: ParseRule[] = [{
    tag: `[${marker}="${name}"]`, priority: 100,
    getAttrs: (element) => {
      try {
        const attrs: unknown = JSON.parse(element.getAttribute('data-fob-attrs') ?? '{}');
        if (!attrs || typeof attrs !== 'object' || Array.isArray(attrs)) return false;
        return Object.fromEntries(attrNames.filter((key) => Object.hasOwn(attrs, key)).map((key) => [key, (attrs as Record<string, unknown>)[key]]));
      } catch { return false; }
    },
  }, ...(spec.parseDOM ?? [])];
  return {
    ...spec,
    parseDOM,
    toDOM: (value: ProseMirrorNode | ProseMirrorMark) => {
      const rendered = kind === 'node'
        ? (spec as NodeSpec).toDOM?.(value as ProseMirrorNode)
        : (spec as MarkSpec).toDOM?.(value as ProseMirrorMark, false);
      const output = rendered ?? (kind === 'mark' ? ['span', 0] : ['div', ...(spec.content ? [0] : [])]);
      if (!Array.isArray(output) || typeof output[0] !== 'string') {
        throw new TypeError(`Shared schema ${name} must return a declarative DOMOutputSpec`);
      }
      const hasAttributes = typeof output[1] === 'object' && output[1] !== null && !Array.isArray(output[1]);
      return [output[0], {
        ...(hasAttributes ? output[1] : {}),
        [marker]: name,
        'data-fob-attrs': JSON.stringify(value.attrs),
        ...(kind === 'node' && 'blockId' in value.attrs ? { 'data-block-id': value.attrs.blockId, 'data-source-block-id': value.attrs.sourceBlockId } : {}),
      }, ...output.slice(hasAttributes ? 2 : 1)] as DOMOutputSpec;
    },
  };
}

function nodeExtension(name: string, spec: NodeSpec): Node {
  const { attrs, toDOM, parseDOM, ...fields } = spec;
  return Node.create({
    ...fields, name, topNode: name === 'doc',
    addAttributes: () => schemaAttributes(attrs),
    parseHTML: () => parseDOM,
    ...(toDOM ? { renderHTML: ({ node }) => toDOM(node) } : {}),
    // Preserve PM metadata such as tableRole, definingForContent, and fobBlock.
    extendNodeSchema: (extension) => extension.name === name ? fields : {},
  });
}

function markExtension(name: string, spec: MarkSpec): Mark {
  const { attrs, toDOM, parseDOM, ...fields } = spec;
  return Mark.create({
    ...fields, name,
    addAttributes: () => schemaAttributes(attrs),
    parseHTML: () => parseDOM,
    ...(toDOM ? { renderHTML: ({ mark }) => toDOM(mark, false) } : {}),
    extendMarkSchema: (extension) => extension.name === name ? fields : {},
  });
}

/** Registration is explicit and first-party; no code discovery or plugin execution. */
export class BlockRegistry {
  private readonly blocks = new Map<string, BlockDefinition>();
  private readonly marks = new Map<string, MarkDefinition>();

  constructor(blocks: readonly BlockDefinition[] = [], marks: readonly MarkDefinition[] = []) {
    blocks.forEach((definition) => this.register(definition));
    marks.forEach((definition) => this.registerMark(definition));
  }

  private assertAvailable(name: string): void {
    if (Object.hasOwn(CORE_NODES, name) || this.blocks.has(name) || this.marks.has(name)) {
      throw new Error(`Duplicate or reserved schema name: ${name}`);
    }
  }

  register(definition: BlockDefinition): this {
    this.assertAvailable(definition.name);
    this.blocks.set(definition.name, defineBlock(definition));
    return this;
  }

  registerMark(definition: MarkDefinition): this {
    this.assertAvailable(definition.name);
    this.marks.set(definition.name, definition);
    return this;
  }

  get(name: string): BlockDefinition | undefined { return this.blocks.get(name); }
  getMark(name: string): MarkDefinition | undefined { return this.marks.get(name); }
  getDefinitions(): readonly BlockDefinition[] { return [...this.blocks.values()]; }
  getMarkDefinitions(): readonly MarkDefinition[] { return [...this.marks.values()]; }

  createExtensions(): Extensions {
    const core = Object.entries(CORE_NODES).map(([name, spec]) => nodeExtension(name,
      name === 'doc' || name === 'text' ? spec : withSerializedAttributes(name, {
        ...spec, attrs: { ...spec.attrs, annotations: nodeAnnotationsAttribute },
      }, 'node') as NodeSpec));
    const blocks = [...this.blocks.values()].map(({ name, schema }) => nodeExtension(name, withSerializedAttributes(name, {
      group: 'block', ...schema, fobBlock: true,
      attrs: { ...schema.attrs, blockId: nullableString, sourceBlockId: nullableString, annotations: nodeAnnotationsAttribute },
    }, 'node') as NodeSpec));
    const marks = [...this.marks.values()].map(({ name, schema }) => markExtension(name, withSerializedAttributes(name, schema, 'mark') as MarkSpec));
    return [...core, ...blocks, ...marks];
  }

  createSchema(): Schema { return getSchema(this.createExtensions()); }
}

import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { KnowledgeMarkdownError, unsupported } from './errors';
import type { MarkdownBlockCodec, MarkdownContext, MarkdownNode } from './types';

export function childNodes(node: ProseMirrorNode): ProseMirrorNode[] {
  const children: ProseMirrorNode[] = [];
  node.forEach((child) => children.push(child));
  return children;
}

function decodeImage(node: MarkdownNode, context: MarkdownContext): ProseMirrorNode {
  const value = node.type === 'imageReference' ? context.reference(node.identifier ?? '', node) : node;
  return context.createBlock(context.blockDefinition('image'), {
    src: value.url ?? '', alt: node.alt ?? '', title: value.title ?? null,
  }, [], node);
}

const paragraph: MarkdownBlockCodec = {
  encode: (node, _definition, context) => ({ type: 'paragraph', children: context.encodeInline(childNodes(node)) }),
  decode(node, context) {
    // The editor models images as blocks. Inline Markdown images are lifted in order.
    const result: ProseMirrorNode[] = [];
    let run: MarkdownNode[] = [];
    const flush = () => {
      if (run.length) result.push(context.createBlock(context.blockDefinition('paragraph'), null, context.decodeInline(run), node));
      run = [];
    };
    for (const child of node.children ?? []) {
      if (child.type === 'image' || child.type === 'imageReference') { flush(); result.push(decodeImage(child, context)); }
      else run.push(child);
    }
    flush();
    return result.length ? result : [context.createBlock(context.blockDefinition('paragraph'), null, [], node)];
  },
};

const list: MarkdownBlockCodec = {
  encode(node, definition, context) {
    const mapping = definition.markdown.fromMd;
    const variant = 'type' in mapping ? mapping.variant : undefined;
    return {
      type: 'list', ordered: variant === 'ordered' || (variant === 'task' && node.attrs.ordered === true),
      start: node.attrs.start ?? 1, spread: false,
      children: childNodes(node).map((child) => context.encodeBlock(child)),
    };
  },
  decode(node, context) {
    const items = node.children ?? [];
    if (!items.length) throw new KnowledgeMarkdownError('invalid_content', 'A Markdown list must contain items', node);
    const result: ProseMirrorNode[] = [];
    let offset = 0;
    while (offset < items.length) {
      const task = items[offset].checked !== null && items[offset].checked !== undefined;
      let end = offset + 1;
      while (end < items.length && (items[end].checked !== null && items[end].checked !== undefined) === task) end++;
      const variant = task ? 'task' : node.ordered ? 'ordered' : 'unordered';
      const definition = context.blockDefinition('list', variant);
      const attrs = task ? { ordered: Boolean(node.ordered), start: node.ordered ? (node.start ?? 1) + offset : 1 }
        : node.ordered ? { start: (node.start ?? 1) + offset } : {};
      const children = items.slice(offset, end).map((item) => {
        if (item.type !== 'listItem') return unsupported(item);
        const blocks = context.decodeBlocks(item.children ?? []);
        // CommonMark allows a list item to start with a heading, code, or a sublist.
        // PM list commands require a first paragraph, so insert an empty one explicitly.
        if (blocks[0]?.type !== context.schema.nodes[context.blockDefinition('paragraph').name]) {
          blocks.unshift(context.createBlock(context.blockDefinition('paragraph'), null, []));
        }
        return context.createBlock(context.blockDefinition('listItem', task ? 'task' : 'plain'),
          task ? { checked: item.checked } : null, blocks, item);
      });
      result.push(context.createBlock(definition, attrs, children, node));
      offset = end;
    }
    return result;
  },
};

const listItem: MarkdownBlockCodec = {
  encode(node, _definition, context) {
    return {
      type: 'listItem', checked: node.attrs.checked ?? null, spread: false,
      children: childNodes(node).map((child) => context.encodeBlock(child)),
    };
  },
  decode(node, context) {
    const task = node.checked !== null && node.checked !== undefined;
    return [context.createBlock(context.blockDefinition('listItem', task ? 'task' : 'plain'),
      task ? { checked: node.checked } : null, context.decodeBlocks(node.children ?? []), node)];
  },
};

const table: MarkdownBlockCodec = {
  encode(node, _definition, context) {
    const rows = childNodes(node);
    const cells = rows.flatMap(childNodes);
    const paragraphName = context.blockDefinition('paragraph').name;
    if (cells.some((cell) => cell.childCount !== 1 || cell.firstChild?.type.name !== paragraphName
      || cell.attrs.colspan !== 1 || cell.attrs.rowspan !== 1)) return context.encodeBlock(node, true);
    return {
      type: 'table', align: childNodes(rows[0]).map((cell) => cell.attrs.align ?? null),
      children: rows.map((row) => context.bindBlock(row, {
        type: 'tableRow', children: childNodes(row).map((cell) => context.bindBlock(cell, context.bindBlock(cell.firstChild!, {
          type: 'tableCell', children: context.encodeInline(childNodes(cell.firstChild!)),
        }))),
      })),
    };
  },
  decode(node, context) {
    const rows = (node.children ?? []).map((row, rowIndex) => {
      if (row.type !== 'tableRow') return unsupported(row);
      const cells = (row.children ?? []).map((cell, column) => {
        if (cell.type !== 'tableCell') return unsupported(cell);
        return context.createBlock(context.blockDefinition('tableCell', rowIndex === 0 ? 'header' : 'cell'),
          { align: node.align?.[column] ?? null }, [context.createBlock(context.blockDefinition('paragraph'), null, context.decodeInline(cell.children ?? []), cell)], cell);
      });
      return context.createBlock(context.blockDefinition('tableRow'), null, cells, row);
    });
    return [context.createBlock(context.blockDefinition('table'), null, rows, node)];
  },
};

/** Grammar implementations are keyed by mdast type, never by editor block name. */
export const STANDARD_BLOCK_CODECS: Readonly<Record<string, MarkdownBlockCodec>> = {
  paragraph,
  heading: {
    encode: (node, _definition, context) => ({ type: 'heading', depth: node.attrs.level, children: context.encodeInline(childNodes(node)) }),
    decode: (node, context) => [context.createBlock(context.blockDefinition('heading'), { level: node.depth }, context.decodeInline(node.children ?? []), node)],
  },
  list, listItem,
  blockquote: {
    encode: (node, _definition, context) => ({ type: 'blockquote', children: childNodes(node).map((child) => context.encodeBlock(child)) }),
    decode: (node, context) => [context.createBlock(context.blockDefinition('blockquote'), null, context.decodeBlocks(node.children ?? []), node)],
  },
  code: {
    encode: (node) => ({ type: 'code', lang: node.attrs.language, value: node.textContent }),
    decode(node, context) {
      if (node.meta) throw new KnowledgeMarkdownError('invalid_attribute', 'Code fence metadata is not represented by the code schema', node);
      return [context.createBlock(context.blockDefinition('code'), { language: node.lang ?? null }, node.value ? [context.schema.text(node.value)] : [], node)];
    },
  },
  math: {
    encode: (node) => ({ type: 'math', value: node.attrs.latex }),
    decode(node, context) {
      if (node.meta) throw new KnowledgeMarkdownError('invalid_attribute', 'Math fence metadata is not represented by the math schema', node);
      return [context.createBlock(context.blockDefinition('math'), { latex: node.value ?? '' }, [], node)];
    },
  },
  thematicBreak: {
    encode: () => ({ type: 'thematicBreak' }),
    decode: (node, context) => [context.createBlock(context.blockDefinition('thematicBreak'), null, [], node)],
  },
  image: {
    encode: (node) => ({ type: 'paragraph', children: [{ type: 'image', url: node.attrs.src, alt: node.attrs.alt, title: node.attrs.title }] }),
    decode: (node, context) => [decodeImage(node, context)],
  },
  table,
  // Structural nodes only appear inside a GFM table, or as explicit directives.
  tableRow: {
    encode: (node, _definition, context) => context.encodeBlock(node, true),
    decode: unsupported,
  },
  tableCell: {
    encode: (node, _definition, context) => context.encodeBlock(node, true),
    decode: unsupported,
  },
};

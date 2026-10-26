import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { createKnowledgeRegistry, defineBlock, isKnowledgeBlock, KNOWLEDGE_BLOCKS, KNOWLEDGE_MARKS } from '../schema';
import { createMarkdownPipeline, KnowledgeMarkdownError } from './index';

const pipeline = createMarkdownPipeline();
const schema = pipeline.schema;
const text = (value: string) => schema.text(value);
const paragraph = (value = '正文', attrs = {}) => schema.nodes.paragraph.create(attrs, value ? text(value) : []);
const document = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);
const roundTrip = (doc: ProseMirrorNode) => {
  doc.check();
  const markdown = pipeline.serialize(doc);
  const restored = pipeline.parse(markdown);
  assert.deepEqual(restored.toJSON(), doc.toJSON(), markdown);
  assert.equal(pipeline.serialize(restored), markdown, 'canonical Markdown should be stable');
  return markdown;
};

const representativeAttributes: Record<string, Record<string, unknown>> = {
  heading: { level: 4 }, orderedList: { start: 9 }, taskList: { ordered: true, start: 3 }, taskItem: { checked: true },
  callout: { emoji: '⚠️', tone: 'custom', background: '#153357cc' }, codeBlock: { language: 'typescript' }, math: { latex: '\\int_0^1 x^2 dx' },
  table: { background: '#7e3d3db3' }, tableRow: { background: '#d8e4ea80' },
  tableCell: { align: 'center', colspan: 2, rowspan: 3, colwidth: [100, 150], background: '#e3dcebb3' }, tableHeader: { align: 'right', colwidth: [240], background: '#7e3d3d00' }, column: { width: 3 },
  image: { src: `asset:${'a'.repeat(64)}`, alt: '架构 [A]', title: '设计', caption: '图 1', mime: 'image/png' },
  video: { src: 'https://example.com/demo.mp4', alt: '演示', title: '项目演示', caption: '评审版', mime: 'video/mp4' },
  audio: { src: 'asset:recording', title: '访谈', caption: '原始素材', mime: 'audio/wav' },
  file: { src: './需求.pdf', title: '需求.pdf', caption: '规格', mime: 'application/pdf', size: 635 },
  embed: { url: 'https://example.com/app?a=1&b=2', title: '交互原型' },
  blockReference: { pageId: 'page_1', targetBlockId: 'source_block' }, pageLink: { pageId: 'page_2', title: '产品规划' },
  databaseView: { databaseId: 'db_1', view: 'calendar', config: { filters: [{ field: 'status', values: ['open', null] }], visible: true } },
  aiBlock: { prompt: '概括 "关键决策"\n保留来源', scope: { pageIds: ['p1', 'p2'] }, schedule: '0 9 * * 1', taskId: 'task_1' },
};

function filledBlock(name: string): ProseMirrorNode {
  let identity = 0;
  const fill = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText) return node;
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(fill(child)));
    const content = node.inlineContent && !children.length ? [text(`内容 ${name}`)] : children;
    return node.type.create({ ...node.attrs, ...(isKnowledgeBlock(node) ? {
      blockId: `${name}_${++identity}`, sourceBlockId: `origin_${identity}`,
      annotations: [{ type: 'suggestion_insert', attrs: { suggestionId: 'suggestion_1', author: 'agent', createdAt: '2026-09-26T00:00:00Z' } }],
    } : {}) }, content, node.marks);
  };
  return fill(schema.nodes[name].createAndFill(representativeAttributes[name])!);
}

function wrapStructural(node: ProseMirrorNode): ProseMirrorNode {
  const parent: Record<string, string> = { listItem: 'bulletList', taskItem: 'taskList', tableRow: 'table', tableCell: 'tableRow', tableHeader: 'tableRow' };
  while (parent[node.type.name]) node = schema.nodes[parent[node.type.name]].create(null, node);
  if (node.type.name === 'column') node = schema.nodes.columns.create(null, [node, schema.nodes.column.create(null, paragraph('第二栏'))]);
  return document(node);
}

describe('registry-backed standard Markdown', () => {
  for (const { name } of KNOWLEDGE_BLOCKS) {
    it(`round-trips ${name} with attributes, nested identities, and provenance`, () => {
      const markdown = roundTrip(wrapStructural(filledBlock(name)));
      assert.doesNotMatch(markdown, /\{#b:/, 'standard mode never generates AI anchors');
    });
  }

  it('uses readable GFM without metadata for naturally representable content', () => {
    const source = '# 标题\n\n普通 **粗体**、*斜体*、~~删除~~、`code`、[链接](https://example.com "标题")。\n\n> 引用\n\n---\n\n```ts\nconst a = 1;\n```\n';
    const output = roundTrip(pipeline.parse(source));
    assert.doesNotMatch(output, /fob-/);
    assert.match(output, /\*\*粗体\*\*/);
    assert.match(output, /```ts/);
  });

  it('retains GFM task state, numbering, mixed items, and nested lists', () => {
    const doc = pipeline.parse('3. [x] 完成\n4. [ ] 待办\n   - 子项\n\n- 普通\n- [x] 任务\n- 普通二');
    const ordered = doc.firstChild!;
    assert.equal(ordered.type.name, 'taskList');
    assert.equal(ordered.attrs.ordered, true);
    assert.equal(ordered.attrs.start, 3);
    assert.equal(ordered.child(0).attrs.checked, true);
    assert.equal(ordered.child(1).attrs.checked, false);
    assert.equal(ordered.child(1).child(1).type.name, 'bulletList');
    assert.deepEqual(Array.from({ length: doc.childCount }, (_, index) => doc.child(index).type.name), ['taskList', 'bulletList', 'taskList', 'bulletList']);
    const output = roundTrip(doc);
    assert.match(output, /3\. \[x\] 完成/);
    assert.match(output, /4\. \[ \] 待办/);
    assert.doesNotMatch(output, /fob-block/);
  });

  it('supports GFM table alignment with identities on rows, cells, and paragraphs', () => {
    const base = pipeline.parse('| 左 | 中 | 右 |\n| :-- | :--: | --: |\n| a | b | c |');
    let counter = 0;
    const identify = (node: ProseMirrorNode): ProseMirrorNode => {
      if (node.isText) return node;
      const children: ProseMirrorNode[] = [];
      node.forEach((child) => children.push(identify(child)));
      return node.type.create({ ...node.attrs, ...(isKnowledgeBlock(node) ? { blockId: `table_${++counter}` } : {}) }, children, node.marks);
    };
    const doc = identify(base);
    assert.deepEqual([0, 1, 2].map((index) => doc.firstChild!.firstChild!.child(index).attrs.align), ['left', 'center', 'right']);
    const output = roundTrip(doc);
    assert.match(output, /\| 左/);
    assert.match(output, /fob-meta/);
    assert.doesNotMatch(output, /fob-block/);
  });

  it('preserves rich tables without flattening multiple paragraphs or cell spans', () => {
    const cell = schema.nodes.tableHeader.create({ colspan: 2, rowspan: 2, colwidth: [120, 220], align: 'center' }, [paragraph('第一段'), paragraph('第二段')]);
    const table = schema.nodes.table.create({ blockId: 'table' }, schema.nodes.tableRow.create(null, cell));
    const output = roundTrip(document(table));
    assert.match(output, /fob-block/);
    assert.match(output, /第一段/);
    assert.match(output, /第二段/);
  });

  it('retains all inline marks including overlapping comments and suggestions', () => {
    const attrs = { href: 'https://example.com?a=1&b=2', title: '链接', color: '#ffeaaa', suggestionId: 's1', author: 'agent:1', createdAt: '2026-09-26T00:00:00Z', threadId: 't1' };
    for (const { name } of KNOWLEDGE_MARKS) {
      roundTrip(document(schema.nodes.paragraph.create(null, schema.text(`标记 ${name}`, [schema.marks[name].create(attrs)]))));
    }
    const comment1 = schema.marks.comment.create({ threadId: 't1' });
    const comment2 = schema.marks.comment.create({ threadId: 't2' });
    const insert = schema.marks.suggestion_insert.create(attrs);
    const deletion = schema.marks.suggestion_delete.create({ ...attrs, suggestionId: 's2' });
    roundTrip(document(schema.nodes.paragraph.create({ blockId: 'marks' }, [
      schema.text('AB', [insert, comment1]), schema.text('CD', [insert, deletion, comment1, comment2]), schema.text('EF', [comment2]),
    ])));
  });

  it('preserves standard nested code formatting instead of stripping outer marks', () => {
    const source = '**加粗 `code`** 和 ~~`deleted code`~~ 和 [**`link code`**](https://example.com)';
    const parsed = pipeline.parse(source);
    const code = parsed.firstChild!.child(1);
    assert.deepEqual(code.marks.map((mark) => mark.type.name), ['bold', 'code']);
    roundTrip(parsed);
  });

  it('keeps annotations in code blocks and formatting around inline atoms', () => {
    const mark = schema.marks.comment.create({ threadId: 'code_thread' });
    const code = schema.nodes.codeBlock.create({ language: 'ts' }, [schema.text('const ', [mark]), text('x = 1;\n')]);
    const formula = schema.nodes.inlineMath.create({ latex: 'x^2' }, null, [schema.marks.bold.create(), mark]);
    const wiki = schema.nodes.wikiLink.create({ target: '研发/路线', pageId: 'page_1', targetBlockId: 'block_1', label: '路线' }, null, [mark]);
    const output = roundTrip(document(code, schema.nodes.paragraph.create(null, [formula, text(' '), wiki])));
    assert.match(output, /code_thread/);
  });

  it('handles nested directives and human-typed string/JSON attributes', () => {
    const input = ':::::columns\n::::column{width=2}\n:::callout{emoji=⚠️ tone=warning}\n注意 :highlight[高亮]{color=yellow} 和 :underline[下划线]。\n:::\n::::\n::::column\n::database-view{databaseId=db view=board config=\'{"filters":[{"field":"x","value":true}]}\'}\n::::\n:::::';
    const doc = pipeline.parse(input);
    assert.equal(doc.firstChild!.firstChild!.attrs.width, 2);
    assert.equal(doc.firstChild!.firstChild!.firstChild!.attrs.emoji, '⚠️');
    assert.deepEqual(doc.firstChild!.child(1).firstChild!.attrs.config, { filters: [{ field: 'x', value: true }] });
    roundTrip(doc);
  });

  it('resolves reference links and lifts inline images without discarding surrounding text', () => {
    const doc = pipeline.parse('前 ![架构][img] 后 [查看][Link]\n\n[img]: assets/a.png "图片标题"\n[link]: https://example.com "目标"');
    assert.equal(doc.childCount, 3);
    assert.equal(doc.child(0).textContent, '前 ');
    assert.equal(doc.child(1).type.name, 'image');
    assert.equal(doc.child(1).attrs.src, 'assets/a.png');
    assert.equal(doc.child(2).lastChild!.marks[0].attrs.href, 'https://example.com');
    roundTrip(doc);
  });

  it('automatically supports custom registered directive blocks and marks', () => {
    const registry = createKnowledgeRegistry().register(defineBlock({
      name: 'decision', schema: { content: 'block+', attrs: { status: { default: 'open', validate: 'string' }, score: { default: 0, validate: 'number' } } },
      markdown: { fromMd: { directive: 'decision', kind: 'container' } }, index: { mode: 'text' },
    })).registerMark({ name: 'reviewer', schema: { attrs: { user: { default: '', validate: 'string' } } }, markdown: { fromMd: { directive: 'reviewer', kind: 'text' } } });
    const custom = createMarkdownPipeline({ registry });
    const doc = custom.parse(':::decision{status=accepted score=7 blockId=decision_1}\n:reviewer[同意]{user=alice}\n:::');
    assert.equal(doc.firstChild!.type.name, 'decision');
    assert.equal(doc.firstChild!.attrs.score, 7);
    assert.equal(doc.firstChild!.firstChild!.firstChild!.marks[0].type.name, 'reviewer');
    assert.deepEqual(custom.parse(custom.serialize(doc)).toJSON(), doc.toJSON());
    assert.match(custom.serialize(doc), /:::decision/);
  });

  it('rejects ambiguous registrations instead of picking a different domain block', () => {
    const registry = createKnowledgeRegistry().register(defineBlock({ name: 'ambiguous', schema: { content: 'inline*' }, markdown: { fromMd: { type: 'paragraph' } }, index: { mode: 'text' } }));
    assert.throws(() => createMarkdownPipeline({ registry }), (error) => error instanceof KnowledgeMarkdownError && error.code === 'ambiguous_mapping');
  });

  it('keeps schema DOM aligned with GFM task/table semantics', () => {
    const list = schema.nodes.taskList.createAndFill({ ordered: true, start: 7 })!;
    const dom = list.type.spec.toDOM!(list);
    assert.ok(Array.isArray(dom));
    assert.equal(dom[0], 'ol');
    assert.equal((dom[1] as Record<string, unknown>).start, 7);
    for (const name of ['tableHeader', 'tableCell']) {
      const cell = schema.nodes[name].createAndFill({ align: 'right' })!;
      const rendered = cell.type.spec.toDOM!(cell);
      assert.ok(Array.isArray(rendered));
      assert.equal((rendered[1] as Record<string, unknown>).align, 'right');
      assert.throws(() => schema.nodes[name].createAndFill({ align: 'diagonal' }), /alignment/);
    }
  });
});

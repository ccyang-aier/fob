import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { getSchema } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { createMarkdownPipeline } from '../markdown';

import { BlockRegistry, KNOWLEDGE_BLOCKS, KNOWLEDGE_MARKS, createKnowledgeExtensions, createKnowledgeRegistry, defineBlock, isKnowledgeBlock, knowledgeSchema } from './index';

const expectedBlocks = ['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'callout', 'codeBlock', 'math', 'horizontalRule', 'table', 'tableRow', 'tableCell', 'tableHeader', 'columns', 'column', 'image', 'video', 'audio', 'file', 'embed', 'blockReference', 'pageLink', 'databaseView', 'aiBlock'];

describe('first-party knowledge schema', () => {
  it('accepts opaque and alpha table backgrounds while rejecting unsafe or malformed colors', () => {
    for (const name of ['table', 'tableRow', 'tableCell', 'tableHeader']) {
      for (const background of ['#7e3d3db3', '#AABBCC00', '#d8e4ea', null]) {
        const node = knowledgeSchema.nodes[name].createAndFill({ background })!;
        assert.doesNotThrow(() => node.check());
        assert.ok(knowledgeSchema.nodeFromJSON(node.toJSON()).eq(node));
      }
      for (const background of ['#123', '#1234567', 'red', 'url(https://example.com)']) assert.throws(() => knowledgeSchema.nodes[name].createAndFill({ background })!.check(), /hex color/);
    }
  });
  it('constructs and serializes every designed block including structural children', () => {
    assert.deepEqual(KNOWLEDGE_BLOCKS.map(({ name }) => name).sort(), [...expectedBlocks].sort());
    for (const name of expectedBlocks) {
      const block = knowledgeSchema.nodes[name].createAndFill({ blockId: `b_${name}`, sourceBlockId: `source_${name}` });
      assert.ok(block, name);
      assert.doesNotThrow(() => block.check(), name);
      assert.ok(isKnowledgeBlock(block));
      const restored = knowledgeSchema.nodeFromJSON(JSON.parse(JSON.stringify(block.toJSON())));
      assert.ok(block.eq(restored), name);
      assert.equal(restored.attrs.blockId, `b_${name}`);
      assert.equal(restored.attrs.sourceBlockId, `source_${name}`);
      const dom = block.type.spec.toDOM?.(block);
      assert.ok(Array.isArray(dom), name);
      assert.equal((dom[1] as Record<string, string>)['data-block-id'], `b_${name}`);
    }
  });

  it('has identical node and mark semantics for headless and Tiptap consumers', () => {
    const editorSchema = getSchema(createKnowledgeExtensions());
    assert.deepEqual(Object.keys(editorSchema.nodes), Object.keys(knowledgeSchema.nodes));
    assert.deepEqual(Object.keys(editorSchema.marks), Object.keys(knowledgeSchema.marks));
    for (const name of expectedBlocks) {
      assert.deepEqual(editorSchema.nodes[name].createAndFill()?.toJSON(), knowledgeSchema.nodes[name].createAndFill()?.toJSON());
      assert.equal(editorSchema.nodes[name].spec.fobBlock, true);
    }
    assert.equal(editorSchema.nodes.tableCell.spec.tableRole, 'cell');
    assert.equal(editorSchema.nodes.tableHeader.spec.tableRole, 'header_cell');
  });

  it('retains media, references, layout, and AI configuration in serialized documents', () => {
    const fixtures = {
      image: { src: 'asset:abc123', alt: '架构图', caption: '产品架构', mime: 'image/png' },
      video: { src: 'asset:video123', title: '评审会议', mime: 'video/mp4' },
      audio: { src: 'asset:audio123', title: '会议录音', mime: 'audio/wav' },
      file: { src: 'asset:pdf123', title: '需求说明.pdf', mime: 'application/pdf' },
      tableCell: { colspan: 2, rowspan: 3, colwidth: [140, 220] },
      column: { width: 3 },
      taskItem: { checked: true },
      codeBlock: { language: 'typescript' },
      math: { latex: '\\int_0^1 x^2 dx' },
      blockReference: { knowledgeBaseId: 'base-1', pageId: 'page-1', targetBlockId: 'block-1' },
      pageLink: { knowledgeBaseId: 'base-2', pageId: 'page-2', title: '产品规划' },
      databaseView: { databaseId: 'database-1', view: 'calendar', config: { dateProperty: 'dueDate', filters: [{ status: 'active' }] } },
      aiBlock: { prompt: '总结当前空间', scope: { pageIds: ['page-1', 'page-2'] }, schedule: '0 9 * * 1', taskId: 'task-1' },
    };
    for (const [name, attrs] of Object.entries(fixtures)) {
      const node = knowledgeSchema.nodes[name].createAndFill(attrs);
      assert.ok(node, name);
      const json = JSON.parse(JSON.stringify(node.toJSON()));
      const restored = knowledgeSchema.nodeFromJSON(json);
      assert.doesNotThrow(() => restored.check());
      assert.ok(restored.eq(node), name);
      for (const [key, value] of Object.entries(attrs)) assert.deepEqual(restored.attrs[key], value, `${name}.${key}`);
      const dom = node.type.spec.toDOM?.(node);
      assert.ok(Array.isArray(dom));
      assert.deepEqual(JSON.parse((dom[1] as Record<string, string>)['data-fob-attrs']), json.attrs);
    }
  });

  it('preserves explicit cross-knowledge-base reference targets through Markdown', () => {
    const markdown = createMarkdownPipeline();
    const target = { knowledgeBaseId: 'other-base', pageId: 'target-page' };
    const nodes = [
      knowledgeSchema.nodes.blockReference.create({ ...target, targetBlockId: 'target-block' }),
      knowledgeSchema.nodes.pageLink.create({ ...target, title: '另一知识库的页面' }),
      knowledgeSchema.nodes.paragraph.create(null, knowledgeSchema.nodes.wikiLink.create({ ...target, target: '目标', targetBlockId: 'target-block' })),
    ];
    for (const node of nodes) {
      const json = node.toJSON();
      assert.ok(knowledgeSchema.nodeFromJSON(json).eq(node));
      const document = knowledgeSchema.nodes.doc.create(null, node);
      assert.deepEqual(markdown.parse(markdown.serialize(document)).toJSON(), document.toJSON());
      const dom = node.type.spec.toDOM?.(node);
      assert.ok(Array.isArray(dom));
      const attrs = JSON.parse((dom[1] as Record<string, string>)['data-fob-attrs']);
      if (node.type.name !== 'paragraph') assert.equal(attrs.knowledgeBaseId, target.knowledgeBaseId);
    }
  });

  it('keeps the document, inline math, wiki links, and line breaks outside block identity', () => {
    for (const name of ['doc', 'hardBreak', 'inlineMath', 'wikiLink']) {
      const node = knowledgeSchema.nodes[name].createAndFill();
      assert.ok(node);
      assert.equal(isKnowledgeBlock(node), false);
      assert.equal(Object.hasOwn(node.attrs, 'blockId'), false);
    }
    const paragraph = knowledgeSchema.nodes.paragraph.create(null, [
      knowledgeSchema.text('参见 '), knowledgeSchema.nodes.wikiLink.create({ target: '项目/规划', label: '规划' }),
      knowledgeSchema.nodes.hardBreak.create(), knowledgeSchema.nodes.inlineMath.create({ latex: 'x^2' }),
    ]);
    assert.doesNotThrow(() => paragraph.check());
    assert.ok(knowledgeSchema.nodeFromJSON(paragraph.toJSON()).eq(paragraph));
  });

  it('rejects invalid content and attributes instead of silently broadening the schema', () => {
    assert.throws(() => knowledgeSchema.nodes.heading.create({ level: 7 }).check(), /integer/);
    assert.throws(() => knowledgeSchema.nodes.taskItem.createAndFill({ checked: 'yes' })?.check(), /boolean/);
    assert.throws(() => knowledgeSchema.nodes.databaseView.create({ view: 'unknown' }).check(), /database view/);
    assert.throws(() => knowledgeSchema.nodes.tableCell.createAndFill({ colspan: 0 })?.check(), /integer/);
    assert.throws(() => knowledgeSchema.nodes.tableCell.createAndFill({ colwidth: [-5] })?.check(), /Column widths/);
    assert.throws(() => knowledgeSchema.nodes.paragraph.create({ blockId: 7 }).check(), /string|null/);
    assert.throws(() => knowledgeSchema.nodes.tableRow.create(null, knowledgeSchema.nodes.paragraph.create()).check(), /Invalid content/);
    assert.throws(() => knowledgeSchema.nodes.columns.create(null, knowledgeSchema.nodes.column.createAndFill()).check(), /Invalid content/);
    assert.throws(() => knowledgeSchema.nodes.doc.create(null, knowledgeSchema.nodes.tableRow.createAndFill()).check(), /Invalid content/);
  });

  it('serializes formatting, comments, and suggestions without changing annotation identity', () => {
    const attrs = { suggestionId: 'suggestion-1', author: 'user-1', createdAt: '2026-09-26T00:00:00.000Z', threadId: 'thread-1', href: 'https://example.com', color: 'yellow' };
    for (const { name } of KNOWLEDGE_MARKS) {
      const mark = knowledgeSchema.marks[name].create(attrs);
      const paragraph = knowledgeSchema.nodes.paragraph.create(null, knowledgeSchema.text('内容', [mark]));
      assert.doesNotThrow(() => paragraph.check());
      assert.ok(knowledgeSchema.nodeFromJSON(paragraph.toJSON()).eq(paragraph), name);
      assert.ok(Array.isArray(mark.type.spec.toDOM?.(mark, true)), name);
    }
    const annotations = ['comment', 'suggestion_insert', 'suggestion_delete'].map((name) => knowledgeSchema.marks[name].create(attrs));
    const code = knowledgeSchema.nodes.codeBlock.create(null, knowledgeSchema.text('const count = 1;', annotations));
    assert.doesNotThrow(() => code.check());
    const comments = ['thread-a', 'thread-b'].map((threadId) => knowledgeSchema.marks.comment.create({ threadId }));
    assert.equal(comments[1].addToSet([comments[0]]).length, 2);
  });

  it('registers a custom first-party block with one definition and exposes its metadata', () => {
    const custom = defineBlock({
      name: 'decision',
      schema: { content: 'block+', attrs: { status: { default: 'open', validate: 'string' } }, definingForContent: true, toDOM: () => ['aside', 0] },
      markdown: { fromMd: { directive: 'decision', kind: 'container' } },
      index: { mode: 'text' }, ai: { describe: (node: ProseMirrorNode) => `Decision: ${node.textContent}` },
      slash: { title: '决策', keywords: ['decision'] },
    });
    const registry = createKnowledgeRegistry().register(custom);
    const schema = registry.createSchema();
    const node = schema.nodes.decision.createAndFill({ blockId: 'decision-1', status: 'accepted' });
    assert.ok(node);
    assert.doesNotThrow(() => node.check());
    assert.equal(schema.nodes.decision.spec.definingForContent, true);
    assert.equal(registry.get('decision'), custom);
    assert.equal(registry.get('decision')?.slash?.title, '决策');
    assert.equal(registry.get('decision')?.ai?.describe(node), 'Decision: ');
    assert.ok(schema.nodeFromJSON(node.toJSON()).eq(node));
    assert.ok(getSchema(registry.createExtensions()).nodes.decision);
    assert.equal(knowledgeSchema.nodes.decision, undefined);
  });

  it('rejects duplicate or reserved names and caller-owned block identity', () => {
    const registry = createKnowledgeRegistry();
    assert.throws(() => registry.register(KNOWLEDGE_BLOCKS[0]), /Duplicate/);
    assert.throws(() => registry.registerMark(KNOWLEDGE_MARKS[0]), /Duplicate/);
    assert.throws(() => registry.registerMark({ ...KNOWLEDGE_MARKS[0], name: 'paragraph' }), /Duplicate/);
    assert.throws(() => new BlockRegistry([{ ...KNOWLEDGE_BLOCKS[0], name: 'text' }]), /reserved/);
    assert.throws(() => defineBlock({ ...KNOWLEDGE_BLOCKS[0], name: 'bad name' }), /Invalid block name/);
    assert.throws(() => defineBlock({ ...KNOWLEDGE_BLOCKS[0], schema: { inline: true } }), /cannot be inline/);
    assert.throws(() => defineBlock({ ...KNOWLEDGE_BLOCKS[0], schema: { attrs: { blockId: { default: 'fixed' } } } }), /owned by the registry/);
  });
});

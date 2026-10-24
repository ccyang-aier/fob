import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { KNOWLEDGE_BLOCKS, createKnowledgeRegistry, defineBlock, knowledgeSchema as schema, repairBlockIds } from '../schema';
import { createMarkdownPipeline } from '../markdown';
import { compareHistoryDocuments, HistoryDiffError } from './index';
import type { HistoryDiffOptions } from './index';

const doc = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);
const paragraph = (id: string, text = '') => schema.nodes.paragraph.create({ blockId: id }, text ? schema.text(text) : []);
const quote = (id: string, ...children: ProseMirrorNode[]) => schema.nodes.blockquote.create({ blockId: id }, children);
function applyInline(before: ProseMirrorNode, after: ProseMirrorNode, options?: HistoryDiffOptions) {
  const changes = compareHistoryDocuments(before, after, options).flatMap((block) => block.inline?.changes ?? []);
  const transform = new Transform(before);
  for (const change of [...changes].sort((a, b) => b.before.from - a.before.from)) {
    transform.replaceWith(change.before.from, change.before.to, after.slice(change.after.from, change.after.to).content);
  }
  assert.deepEqual(transform.doc.toJSON(), after.toJSON());
  return changes;
}

describe('stable block history comparison', () => {
  it('compares absent versions, actual empty paragraphs, and identical adjacent snapshots', () => {
    assert.deepEqual(compareHistoryDocuments(null, null), []);
    const empty = doc(paragraph('empty'));
    assert.deepEqual(compareHistoryDocuments(empty, empty), []);
    assert.deepEqual(compareHistoryDocuments(empty, schema.nodeFromJSON(empty.toJSON())), []);
    const [added] = compareHistoryDocuments(null, empty);
    assert.deepEqual(added.reasons, ['added']);
    assert.equal(added.before, null);
    assert.deepEqual(added.after?.range, { from: 0, to: 2 });
    assert.deepEqual(compareHistoryDocuments(empty, null)[0].reasons, ['removed']);
    assert.throws(() => compareHistoryDocuments(schema.nodes.doc.create(), empty), (error) => error instanceof HistoryDiffError && error.code === 'invalid_document');
  });

  it('insertion and deletion do not misclassify shifted siblings as moves', () => {
    const a = paragraph('a'), b = paragraph('b'), c = paragraph('c'), x = paragraph('x');
    assert.deepEqual(compareHistoryDocuments(doc(a, b, c), doc(x, a, b, c)).map((item) => [item.blockId, item.reasons]), [['x', ['added']]]);
    assert.deepEqual(compareHistoryDocuments(doc(a, b, c), doc(b, c)).map((item) => [item.blockId, item.reasons]), [['a', ['removed']]]);
    assert.deepEqual(compareHistoryDocuments(doc(a, b, c), doc(b, x, c)).map((item) => [item.blockId, item.reasons]), [['x', ['added']], ['a', ['removed']]]);
  });

  it('stable IDs identify minimal deterministic sibling moves even with identical text', () => {
    const a = paragraph('a', 'same'), b = paragraph('b', 'same'), c = paragraph('c', 'same');
    const diff = compareHistoryDocuments(doc(a, b, c), doc(b, c, a));
    assert.deepEqual(diff.map((item) => [item.blockId, item.reasons]), [['a', ['moved']]]);
    assert.equal(diff[0].before?.index, 0);
    assert.equal(diff[0].after?.index, 2);
    assert.deepEqual(compareHistoryDocuments(doc(a, b), doc(b, a)), compareHistoryDocuments(doc(a, b), doc(b, a)));
    assert.deepEqual(compareHistoryDocuments(doc(a), doc(paragraph('new', 'same'))).map((item) => item.reasons), [['added'], ['removed']]);
  });

  it('moving a container does not report every descendant as another move', () => {
    const a = quote('container', paragraph('nested', 'content')), b = paragraph('b'), c = paragraph('c');
    assert.deepEqual(compareHistoryDocuments(doc(a, b, c), doc(b, c, a)).map((item) => [item.blockId, item.reasons]), [['container', ['moved']]]);
  });

  it('reparenting is a move and reports both locations, not delete/add', () => {
    const before = doc(quote('left', paragraph('x'), paragraph('a')), quote('right', paragraph('b')));
    const after = doc(quote('left', paragraph('a')), quote('right', paragraph('b'), paragraph('x')));
    const [change] = compareHistoryDocuments(before, after);
    assert.equal(change.blockId, 'x');
    assert.deepEqual(change.reasons, ['moved']);
    assert.equal(change.before?.parentBlockId, 'left');
    assert.equal(change.after?.parentBlockId, 'right');
    assert.deepEqual(change.before?.path, [0, 0]);
    assert.deepEqual(change.after?.path, [1, 1]);
  });

  it('a moved and edited block reports both changes, in after-document order', () => {
    const before = doc(paragraph('a', 'before'), paragraph('b'), paragraph('c'));
    const after = doc(paragraph('b'), paragraph('c'), paragraph('a', 'after'));
    const diff = compareHistoryDocuments(before, after);
    assert.equal(diff.length, 1);
    assert.deepEqual(diff[0].reasons, ['moved', 'inline']);
    assert.ok(diff[0].inline?.changes.length);
  });

  it('type, media attributes, annotation changes and provenance remain explainable', () => {
    const before = doc(paragraph('heading', 'Title'), schema.nodes.image.create({ blockId: 'image', src: 'asset:a', caption: 'Old' }));
    const after = doc(schema.nodes.heading.create({ blockId: 'heading', level: 2 }, schema.text('Title')),
      schema.nodes.image.create({ blockId: 'image', src: 'asset:b', caption: 'New', sourceBlockId: 'source' }));
    const diff = compareHistoryDocuments(before, after);
    assert.deepEqual(diff[0].reasons, ['type', 'attributes']);
    assert.deepEqual(diff[0].attributes, ['level']);
    assert.deepEqual(diff[1].attributes, ['caption', 'sourceBlockId', 'src']);
    assert.equal(diff[1].inline, null);
    const annotated = schema.nodes.image.create({ blockId: 'image', src: 'asset:a', caption: 'Old',
      annotations: [{ type: 'suggestion_delete', attrs: { suggestionId: 'suggestion', author: 'author', createdAt: '2026-09-26T00:00:00Z' } }] });
    assert.deepEqual(compareHistoryDocuments(doc(before.child(1)), doc(annotated))[0].attributes, ['annotations']);
  });

  it('compares JSON attribute values structurally, independent of key insertion order', () => {
    const before = doc(schema.nodes.databaseView.create({ blockId: 'db', config: { one: 1, two: [2, { a: true, b: false }] } }));
    const after = doc(schema.nodes.databaseView.create({ blockId: 'db', config: { two: [2, { b: false, a: true }], one: 1 } }));
    assert.deepEqual(compareHistoryDocuments(before, after), []);
  });

  it('nested table text only changes its own paragraph, not every ancestor', () => {
    const table = (value: string) => schema.nodes.table.create({ blockId: 'table' }, schema.nodes.tableRow.create({ blockId: 'row' },
      schema.nodes.tableCell.create({ blockId: 'cell' }, paragraph('cell_text', value))));
    const before = doc(table('old')), after = doc(table('new'));
    const diff = compareHistoryDocuments(before, after);
    assert.deepEqual(diff.map((item) => [item.blockId, item.reasons]), [['cell_text', ['inline']]]);
    assert.deepEqual(diff[0].after?.path, [0, 0, 0, 0]);
    applyInline(before, after);
  });

  it('all 27 first-party blocks and nested IDs survive real Markdown snapshot roundtrip', () => {
    let next = 0;
    const roots = KNOWLEDGE_BLOCKS.filter(({ name }) => schema.nodes[name].isInGroup('block')).map(({ name }) => schema.nodes[name].createAndFill()!);
    // Cover both cell types independently of the schema's default fill order.
    roots.push(schema.nodes.table.create(null, ['tableCell', 'tableHeader'].map(type => schema.nodes.tableRow.create(null, schema.nodes[type].createAndFill()!))));
    const original = repairBlockIds(doc(...roots), { generateId: () => `block_${++next}` }).doc;
    const pipeline = createMarkdownPipeline();
    const restored = pipeline.parse(pipeline.serialize(original));
    assert.deepEqual(compareHistoryDocuments(original, restored), []);
    assert.deepEqual(new Set(compareHistoryDocuments(null, original).map((item) => item.after?.type)), new Set(KNOWLEDGE_BLOCKS.map((item) => item.name)));
    const json = original.toJSON();
    compareHistoryDocuments(original, null);
    assert.deepEqual(original.toJSON(), json, 'comparison must not mutate its snapshots');
  });

  it('supports first-party custom blocks without another block-type switch', () => {
    const custom = createKnowledgeRegistry().register(defineBlock({ name: 'decision', schema: { atom: true, attrs: { status: { default: 'open', validate: 'string' } } },
      markdown: { fromMd: { directive: 'decision', kind: 'leaf' } }, index: { mode: 'text' } })).createSchema();
    const before = custom.nodes.doc.create(null, custom.nodes.decision.create({ blockId: 'decision' }));
    const after = custom.nodes.doc.create(null, custom.nodes.decision.create({ blockId: 'decision', status: 'accepted' }));
    assert.deepEqual(compareHistoryDocuments(before, after)[0].attributes, ['status']);
  });

  it('all permutations report the minimum number of same-parent moves', () => {
    const nodes = ['a', 'b', 'c', 'd', 'e'].map((id) => paragraph(id));
    function visit(prefix: number[], remaining: number[]) {
      if (remaining.length) { for (const value of remaining) visit([...prefix, value], remaining.filter((item) => item !== value)); return; }
      // Independent exhaustive subsequence oracle for five blocks.
      let longest = 0;
      for (let bits = 0; bits < 32; bits++) {
        const values = prefix.filter((_, index) => bits & (1 << index));
        if (values.every((value, index) => index === 0 || value > values[index - 1])) longest = Math.max(longest, values.length);
      }
      const diff = compareHistoryDocuments(doc(...nodes), doc(...prefix.map((index) => nodes[index])));
      assert.equal(diff.length, 5 - longest);
      assert.ok(diff.every((item) => item.reasons.length === 1 && item.reasons[0] === 'moved'));
    }
    visit([], [0, 1, 2, 3, 4]);
  });

  it('refuses ambiguous identities or incompatible schemas instead of silently inventing IDs', () => {
    const valid = doc(paragraph('valid'));
    for (const invalid of [doc(schema.nodes.paragraph.create()), doc(paragraph('same'), paragraph('same')), doc(paragraph('bad space'))]) {
      assert.throws(() => compareHistoryDocuments(invalid, valid), (error) => error instanceof HistoryDiffError && error.code === 'invalid_block_identity');
    }
    const other = createKnowledgeRegistry().createSchema();
    assert.throws(() => compareHistoryDocuments(valid, other.nodeFromJSON(valid.toJSON())), (error) => error instanceof HistoryDiffError && error.code === 'schema_mismatch');
  });
});

describe('precise bounded inline differences', () => {
  it('reports insertion/deletion/replacement as exact UTF-16 ranges and reconstructs the next snapshot', () => {
    for (const [before, after] of [['', 'new'], ['old', ''], ['hello world', 'hello team'], ['abXXcdYYef', 'ab11cd22ef'], ['repeat repeat end', 'repeat end'], ['a\r\nb', 'a\nb']]) {
      const changes = applyInline(doc(paragraph('p', before)), doc(paragraph('p', after)));
      assert.ok(changes.length);
    }
    const changes = applyInline(doc(paragraph('p', 'abXXcdYYef')), doc(paragraph('p', 'ab11cd22ef')));
    assert.equal(changes.length, 2);
    assert.deepEqual(changes[0], { before: { from: 3, to: 5 }, after: { from: 3, to: 5 } });
  });

  it('does not split emoji ZWJ sequences, modifiers, combining marks or Chinese text', () => {
    const beforeText = 'A👩🏽‍💻e\u0301中文Z', afterText = 'A👩🏻‍💻e\u0301汉语Z';
    const changes = applyInline(doc(paragraph('p', beforeText)), doc(paragraph('p', afterText)));
    assert.equal(beforeText.slice(changes[0].before.from - 1, changes[0].before.to - 1), '👩🏽‍💻');
    assert.equal(afterText.slice(changes[0].after.from - 1, changes[0].after.to - 1), '👩🏻‍💻');
    assert.equal(changes.length, 2);
    applyInline(doc(paragraph('p', 'café')), doc(paragraph('p', 'cafe\u0301'))); // no lossy normalization
  });

  it('formatting, link targets, comments and suggestion metadata are not invisible edits', () => {
    const before = doc(paragraph('p', 'content'));
    for (const mark of [schema.marks.bold.create(), schema.marks.link.create({ href: 'https://example.com' }),
      schema.marks.comment.create({ threadId: 'thread' }), schema.marks.suggestion_insert.create({ suggestionId: 's', author: 'u', createdAt: '2026-09-26' })]) {
      const after = doc(schema.nodes.paragraph.create({ blockId: 'p' }, schema.text('content', [mark])));
      assert.deepEqual(compareHistoryDocuments(before, after)[0].reasons, ['inline']);
      applyInline(before, after);
    }
    const linked = (href: string) => doc(schema.nodes.paragraph.create({ blockId: 'p' }, schema.text('link', [schema.marks.link.create({ href })])));
    applyInline(linked('https://example.com/a'), linked('https://example.com/b'));
  });

  it('inline atoms, hard breaks and their attributes remain indivisible PM nodes', () => {
    const inline = (latex: string, label: string) => doc(schema.nodes.paragraph.create({ blockId: 'p' }, [schema.text('Before'),
      schema.nodes.inlineMath.create({ latex }), schema.nodes.hardBreak.create(), schema.nodes.wikiLink.create({ target: 'Page', label }), schema.text('After')]));
    const changes = applyInline(inline('x', 'Old'), inline('y', 'New'));
    assert.equal(changes.length, 2);
    assert.equal(changes[0].before.to - changes[0].before.from, 1);
  });

  it('handles text-to-atom and text-to-container changes without assigning child text to the parent', () => {
    const before = doc(paragraph('p', 'old'));
    const after = doc(schema.nodes.image.create({ blockId: 'p', src: 'asset:x' }));
    const [change] = compareHistoryDocuments(before, after);
    assert.deepEqual(change.inline?.changes, [{ before: { from: 1, to: 4 }, after: { from: 0, to: 0 } }]);
    const container = doc(quote('p', paragraph('child', 'new child')));
    const diff = compareHistoryDocuments(before, container);
    assert.deepEqual(diff[0].inline?.changes[0].after, { from: 1, to: 1 });
    assert.deepEqual(diff[1].reasons, ['added']);
  });

  it('bounds total LCS work, labels coarse spans, and still reconstructs exact content', () => {
    const before = doc(paragraph('a', 'aa'), paragraph('b', 'aa')), after = doc(paragraph('a', 'bb'), paragraph('b', 'bb'));
    const diff = compareHistoryDocuments(before, after, { maxInlineComparisonCells: 9 });
    assert.equal(diff[0].inline?.precision, 'grapheme');
    assert.equal(diff[1].inline?.precision, 'coarse');
    applyInline(before, after, { maxInlineComparisonCells: 9 });
    const old = doc(paragraph('large', `prefix ${'a'.repeat(15_000)} suffix`));
    const updated = doc(paragraph('large', `prefix ${'b'.repeat(15_000)} suffix`));
    assert.equal(compareHistoryDocuments(old, updated)[0].inline?.precision, 'coarse');
    applyInline(old, updated);
    for (const cells of [-1, NaN, 1.5, 8_000_001]) assert.throws(() => compareHistoryDocuments(before, after, { maxInlineComparisonCells: cells }), HistoryDiffError);
  });

  it('reconstructs deterministic adversarial adjacent text snapshots with fine and coarse budgets', () => {
    let seed = 20260926;
    const next = (max: number) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max; };
    const alphabet = ['a', 'b', '中', '文', ' ', '\n', '👩‍💻', 'e\u0301'];
    for (let sample = 0; sample < 120; sample++) {
      const text = Array.from({ length: 3 + next(40) }, () => alphabet[next(alphabet.length)]).join('');
      const segments = [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map((item) => item.segment);
      segments.splice(next(segments.length + 1), next(5), alphabet[next(alphabet.length)], alphabet[next(alphabet.length)]);
      applyInline(doc(paragraph('p', text)), doc(paragraph('p', segments.join(''))), { maxInlineComparisonCells: sample % 2 ? 0 : 2_000_000 });
    }
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Root } from 'mdast';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

import { createKnowledgeRegistry, defineBlock } from '../schema';
import { createMarkdownPipeline, KnowledgeMarkdownError } from './index';
import type { MarkdownErrorCode } from './index';

const pipeline = createMarkdownPipeline();
const schema = pipeline.schema;
const doc = (...nodes: ProseMirrorNode[]) => schema.nodes.doc.create(null, nodes);
const paragraph = (value: string, attrs = {}) => schema.nodes.paragraph.create(attrs, value ? schema.text(value) : []);
function roundTrip(node: ProseMirrorNode): string {
  const markdown = pipeline.serialize(node);
  assert.deepEqual(pipeline.parse(markdown).toJSON(), node.toJSON(), markdown);
  return markdown;
}
function errorCode(input: string, code: MarkdownErrorCode): void {
  assert.throws(() => pipeline.parse(input), (error) => error instanceof KnowledgeMarkdownError && error.code === code);
}

describe('Markdown fidelity and explicit failures', () => {
  it('preserves empty blocks, leading/trailing whitespace, tabs, CRLF, NUL, and literal syntax', () => {
    const values = ['', ' ', '  leading', 'trailing  ', 'a\n\nb', '\tindent\t', 'first\r\nsecond\rlast', '\u0000null\u007fend',
      '[[literal]]', ':unknown[plain text]', ':::callout\nnot a directive', '*x* _y_ ~z~ `code`', '{#b:not_an_anchor}', '![not image](x)', '[]()<>#|&"\'\\'];
    for (const value of values) {
      for (const mark of [null, schema.marks.bold.create(), schema.marks.code.create(), schema.marks.comment.create({ threadId: 't1' })]) {
        const node = schema.nodes.paragraph.create({ blockId: 'whitespace' }, value ? schema.text(value, mark ? [mark] : []) : []);
        assert.doesNotThrow(() => roundTrip(doc(node)), JSON.stringify({ value, mark: mark?.type.name }));
      }
    }
  });

  it('does not merge adjacent lists or quotations, including nested containers', () => {
    const item = (value: string) => schema.nodes.listItem.create(null, paragraph(value));
    const list = (value: string) => schema.nodes.bulletList.create(null, item(value));
    const quote = (value: string) => schema.nodes.blockquote.create(null, paragraph(value));
    const source = doc(list('one'), list('two'), quote('three'), quote('four'), schema.nodes.callout.create(null, [list('five'), list('six'), quote('seven'), quote('eight')]));
    const output = roundTrip(source);
    assert.match(output, /fob-boundary/);
    assert.doesNotMatch(output, /fob-block/);
  });

  it('uses a real wiki tokenizer and leaves escaped wiki syntax and code untouched', () => {
    const source = '[[项目/规划|路线]] [[页#^block_1]] \\[\\[不是链接\\]\\] `[[代码]]`';
    const parsed = pipeline.parse(source).firstChild!;
    const links: ProseMirrorNode[] = [];
    parsed.forEach((node) => { if (node.type.name === 'wikiLink') links.push(node); });
    assert.equal(links.length, 2);
    assert.equal(links[0].attrs.target, '项目/规划');
    assert.equal(links[0].attrs.label, '路线');
    assert.equal(links[1].attrs.targetBlockId, 'block_1');
    assert.ok(parsed.textContent.includes('[[不是链接]]'));
    assert.ok(parsed.lastChild!.marks.some((mark) => mark.type.name === 'code'));
    roundTrip(doc(parsed));
  });

  it('retains wiki escapes, page resolution, block references, and empty labels', () => {
    for (const attrs of [
      { target: 'a|b]c[d\\e', label: 'x|y]z[\\q', pageId: 'resolved_page', targetBlockId: 'block_1' },
      { target: 'Page', label: '' }, { target: '', label: null, targetBlockId: 'block' },
      { target: 'literal#^part', targetBlockId: null }, { target: 'a\nb', label: 'line\rbreak' },
    ]) roundTrip(doc(schema.nodes.paragraph.create(null, schema.nodes.wikiLink.create(attrs))));
  });

  it('handles wiki links, formulas, formatting, and escaped pipes inside GFM tables', () => {
    const source = `| 表达式 | 来源 |\n| -- | -- |\n| $a \\vert b$ | [[页${'\\'.repeat(3)}|名称\\|标签]] **粗体** |`;
    const parsed = pipeline.parse(source);
    const wiki = parsed.firstChild!.child(1).child(1).firstChild!.firstChild!;
    assert.equal(wiki.attrs.target, '页|名称');
    assert.equal(wiki.attrs.label, '标签');
    const output = roundTrip(parsed);
    assert.match(output, /\| 表达式/);
    assert.doesNotMatch(output, /fob-block/);
  });

  it('preserves inline/block math delimiter edge cases and empty formulas', () => {
    for (const latex of ['', 'x^2', ' x ', 'a\nb', '$x$ + $$y$$', 'a\r\nb', '\u0000']) {
      roundTrip(doc(schema.nodes.math.create({ latex }), schema.nodes.paragraph.create(null, schema.nodes.inlineMath.create({ latex }))));
    }
  });

  it('preserves fenced-code text, language metadata, and annotation ranges exactly', () => {
    const comment = schema.marks.comment.create({ threadId: 'code' });
    for (const value of ['', '\n', 'one\n\ntwo\n', 'one\r\ntwo', '```js\ninner\n```', '\u0000']) {
      for (const language of [null, '', 'ts', 'language with spaces']) {
        const content = value ? [schema.text(value, [comment])] : [];
        roundTrip(doc(schema.nodes.codeBlock.create({ language }, content)));
      }
    }
  });

  it('round-trips deterministic combinations of inline atoms, marks, and literal punctuation', () => {
    const values = ['正文', ' space ', '\nline', '[[literal]]', ':literal[x]', 'a|b', '\\', 'www.example.com'];
    const marks = [[], [schema.marks.bold.create()], [schema.marks.italic.create()], [schema.marks.comment.create({ threadId: 'fuzz' })]];
    for (let index = 0; index < 48; index++) {
      const left = schema.text(values[index % values.length], marks[index % marks.length]);
      const atom = index % 2 ? schema.nodes.inlineMath.create({ latex: `x_${index}` })
        : schema.nodes.wikiLink.create({ target: `页 ${index}`, label: '标签' });
      const right = schema.text(values[(index * 3 + 1) % values.length], marks[(index + 1) % marks.length]);
      roundTrip(doc(schema.nodes.paragraph.create({ blockId: `case_${index}` }, [left, atom, right])));
    }
  });

  it('preserves media titles/captions, empty vs null attrs, and unsafe URLs as inert data', () => {
    for (const src of ['', 'asset:abc', './x y.png', 'https://example.com/a(b).png?a=1&b=2', 'javascript:alert(1)', 'data:image/svg+xml,<svg/>']) {
      for (const title of [null, '', 'quote "single\'"\nnext']) {
        roundTrip(doc(schema.nodes.image.create({ src, alt: '[]\n文字', title, caption: 'caption\u0000value' })));
      }
    }
  });

  it('preserves annotated empty/non-text blocks through schema-owned attrs', () => {
    // S01 installs these attrs centrally; this also proves future registry attrs
    // do not require another Markdown block-name switch.
    const registry = createKnowledgeRegistry().register(defineBlock({
      name: 'annotatedAsset', schema: { atom: true, attrs: { review: { default: null } } },
      markdown: { fromMd: { directive: 'annotated-asset', kind: 'leaf' } }, index: { mode: 'media' },
    }));
    const custom = createMarkdownPipeline({ registry });
    const asset = custom.schema.nodes.annotatedAsset.create({ review: [{ type: 'suggestion_delete', attrs: { suggestionId: 's1', author: 'agent', createdAt: 'now' } }] });
    const source = custom.schema.nodes.doc.create(null, asset);
    assert.deepEqual(custom.parse(custom.serialize(source)).toJSON(), source.toJSON());
    const annotations = [{ type: 'suggestion_delete', attrs: { suggestionId: 's1', author: 'agent', createdAt: '2026-09-26T00:00:00Z' } }];
    roundTrip(doc(schema.nodes.image.create({ src: 'https://example.com/a.png', annotations }),
      schema.nodes.paragraph.create({ annotations }, [schema.nodes.inlineMath.create({ latex: 'x', annotations }), schema.nodes.hardBreak.create({ annotations }), schema.nodes.wikiLink.create({ target: '页', annotations })])));
  });

  it('offers the same round-trip pipeline at the mdast boundary', () => {
    const source = pipeline.parse('## H\n\n- [x] Task\n\n:::callout{tone=warning}\n[[页]]\n:::');
    const tree = pipeline.toMdast(source);
    assert.equal(tree.type, 'root');
    assert.deepEqual(pipeline.fromMdast(tree).toJSON(), source.toJSON());
    assert.equal(pipeline.parse('').childCount, 1);
    assert.equal(pipeline.parse('').firstChild!.type.name, 'paragraph');
  });

  it('returns source-located errors for unsupported HTML and unregistered directives', () => {
    assert.throws(() => pipeline.parse('正文\n\n<script>alert(1)</script>'), (error) => error instanceof KnowledgeMarkdownError
      && error.code === 'unsupported_node' && error.line === 3 && error.column === 1);
    errorCode('::unknown{value=1}', 'unknown_directive');
    errorCode(':unknown[内容]', 'unknown_directive');
    errorCode('引用[^note]\n\n[^note]: 注释', 'unsupported_node');
    errorCode('![[需解析附件.png]]', 'unsupported_node');
    errorCode('```ts title=example\ncode\n```', 'invalid_attribute');
  });

  it('rejects unknown/invalid attrs, malformed typed values, and impossible content', () => {
    errorCode('::embed{url=https://example.com surprise=yes}', 'invalid_attribute');
    errorCode('::database-view{view=unknown}', 'invalid_content');
    errorCode('::database-view{config=not-json}', 'invalid_content');
    errorCode('::database-view{fob-attrs=broken}', 'invalid_attribute');
    errorCode('::database-view{view=table fob-attrs=\'{"view":"board"}\'}', 'invalid_attribute');
    errorCode(':::columns\n正文\n:::', 'invalid_content');
    errorCode(':::callout[未建模标题]\n正文\n:::', 'invalid_attribute');
    errorCode('::embed[未建模标题]{url=https://example.com}', 'invalid_content');
    errorCode(':fob-text{value=123}', 'invalid_attribute');
    errorCode(':fob-inline{type=paragraph}', 'invalid_content');
    errorCode(':fob-mark[x]{type=unknown}', 'unknown_directive');
  });

  it('rejects dangling, duplicate, stale, or malicious metadata rather than applying it elsewhere', () => {
    const metadata = (entries: unknown) => `::fob-meta{data='${JSON.stringify(entries)}'}`;
    errorCode(metadata([]), 'invalid_metadata');
    errorCode(`${metadata([])}\n\n${metadata([])}\n\n正文`, 'invalid_metadata');
    errorCode(`${metadata([{ path: [9], type: 'paragraph', attrs: { blockId: 'b' } }])}\n\n正文`, 'invalid_metadata');
    errorCode(`${metadata([{ path: [], type: 'heading', attrs: { blockId: 'b' } }])}\n\n正文`, 'invalid_metadata');
    errorCode(`${metadata([{ path: [], type: 'paragraph' }, { path: [], type: 'paragraph' }])}\n\n正文`, 'invalid_metadata');
    errorCode(`${metadata([{ path: [], type: 'paragraph', attrs: { unexpected: 'value' } }])}\n\n正文`, 'invalid_attribute');
    errorCode(`${metadata([{ path: [], type: 'paragraph', attrs: { blockId: 5 } }])}\n\n正文`, 'invalid_metadata');
    errorCode('::fob-boundary{surprise=yes}', 'invalid_metadata');
  });

  it('validates externally supplied AST and refuses malformed mark payloads', () => {
    const tree = { type: 'root', children: [{ type: 'unknown' }] } as unknown as Root;
    assert.throws(() => pipeline.fromMdast(tree), KnowledgeMarkdownError);
    errorCode(':fob-mark[x]{type=comment fob-attrs=\'{"threadId":7}\'}', 'invalid_attribute');
    errorCode(':fob-mark[x]{type=comment fob-attrs=\'{"threadId":"t","unknown":true}\'}', 'invalid_attribute');
    errorCode('::fob-block{type=image fob-marks=\'[{"type":"missing"}]\'}', 'unsupported_mark');
  });

  it('rejects reserved directive names and schema-owned annotations at registration', () => {
    const definition = defineBlock({ name: 'customMeta', schema: { atom: true }, markdown: { fromMd: { directive: 'fob-meta', kind: 'leaf' } }, index: { mode: 'skip' } });
    assert.throws(() => createMarkdownPipeline({ registry: createKnowledgeRegistry().register(definition) }), /reserved/);
    assert.throws(() => defineBlock({ ...definition, schema: { attrs: { annotations: { default: null } } } }), /owned by the registry/);
  });
});

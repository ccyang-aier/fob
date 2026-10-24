import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DOMOutputSpec } from '@tiptap/pm/model';

import { knowledgeSchema, safeKnowledgeUrl } from './index';

function attributes(output: DOMOutputSpec | undefined): Record<string, unknown> {
  assert.ok(Array.isArray(output));
  return output[1] as Record<string, unknown>;
}

describe('knowledge URL policy', () => {
  it('accepts explicit HTTP URLs and knowledge base asset identifiers for links and media', () => {
    for (const url of ['https://example.com/media?q=图', 'http://localhost:8710/file', `asset:${'ab'.repeat(32)}`]) {
      assert.equal(safeKnowledgeUrl(url, 'link'), url);
      assert.equal(safeKnowledgeUrl(url, 'media'), url);
    }
    for (const url of ['mailto:writer@example.com?subject=Review', '#b:abc', '/knowledge?page=abc', './notes.md', '../notes.md', '项目/规划.md', '?page=abc']) {
      assert.equal(safeKnowledgeUrl(url, 'link'), url);
      assert.equal(safeKnowledgeUrl(url, 'media'), null);
    }
  });

  it('accepts well-formed blob media URLs without checking their existence', () => {
    for (const url of ['blob:https://example.com/a-not-yet-created-resource', 'blob:http://localhost:3000/abc-123', 'blob:null/abc-123']) {
      assert.equal(safeKnowledgeUrl(url, 'media'), url);
      assert.equal(safeKnowledgeUrl(url, 'link'), null);
    }
    for (const url of ['blob:javascript:alert(1)', 'blob:https://example.com/', 'blob:https://example.com/path/id', 'blob:https://user:password@example.com/id']) {
      assert.equal(safeKnowledgeUrl(url, 'media'), null);
    }
  });

  it('removes executable schemes, obfuscated controls, credentials and ambiguous addresses', () => {
    const unsafe = [
      'javascript:alert(1)', ' JAVASCRIPT:alert(1)', 'java\nscript:alert(1)', 'java\tscript:alert(1)',
      'data:image/svg+xml,<svg onload="alert(1)"></svg>', 'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)', 'file:///etc/passwd', '//example.com/file', '\\\\example.com\\file',
      'https://user:password@example.com/file', 'http:example.com/file', 'asset:../secret', 'asset:abc', '',
    ];
    for (const url of unsafe) {
      assert.equal(safeKnowledgeUrl(url, 'link'), null, url);
      assert.equal(safeKnowledgeUrl(url, 'media'), null, url);
    }
  });

  it('never puts unsafe document attributes into an active href or src', () => {
    const unsafe = 'javascript:alert(1)';
    const link = knowledgeSchema.marks.link.create({ href: unsafe });
    const renderedLink = attributes(link.type.spec.toDOM?.(link, true));
    assert.equal(renderedLink.href, null);
    assert.equal(JSON.parse(String(renderedLink['data-fob-attrs'])).href, unsafe);
    for (const name of ['image', 'audio', 'video']) {
      const node = knowledgeSchema.nodes[name].create({ src: 'data:image/svg+xml,<svg onload="alert(1)"/>' });
      const output = node.type.spec.toDOM?.(node);
      assert.ok(Array.isArray(output));
      assert.equal(attributes(output[2]).src, null, name);
    }
    const file = knowledgeSchema.nodes.file.create({ src: unsafe });
    assert.equal(attributes(file.type.spec.toDOM?.(file))['data-file'], null);
    const embed = knowledgeSchema.nodes.embed.create({ url: unsafe });
    assert.equal(attributes(embed.type.spec.toDOM?.(embed))['data-embed'], null);
  });
});

describe('JSON configuration attributes', () => {
  function checkConfig(config: unknown) {
    const node = knowledgeSchema.nodes.databaseView.create({ config });
    node.check();
    return node;
  }

  it('accepts nested JSON values and repeated references that are not cycles', () => {
    const common = { status: 'active' };
    const config = { filter: common, otherFilter: common, choices: [null, 4, false, '标签', { date: '2026-09-26' }] };
    const node = checkConfig(config);
    assert.deepEqual(knowledgeSchema.nodeFromJSON(JSON.parse(JSON.stringify(node.toJSON()))).attrs.config, config);
    assert.doesNotThrow(() => checkConfig(Object.assign(Object.create(null), { width: 200 })));
    assert.doesNotThrow(() => checkConfig(null));
  });

  it('rejects non-JSON values at any depth and does not execute getters', () => {
    for (const value of [new Date(), new Map(), new Set(), undefined, () => 1, Symbol('x'), 1n, NaN, Infinity]) {
      assert.throws(() => checkConfig({ nested: { value } }), /JSON/);
    }
    for (const value of [new Date(), new Map(), [], 'text', 5]) {
      assert.throws(() => checkConfig(value), /JSON/);
    }
    const validate = knowledgeSchema.nodes.databaseView.spec.attrs?.config.validate;
    assert.equal(typeof validate, 'function');
    if (typeof validate === 'function') assert.throws(() => validate(undefined), /JSON/);
    let getterInvoked = false;
    const config = { get secret() { getterInvoked = true; return 'secret'; } };
    assert.throws(() => checkConfig(config), /enumerable data/);
    assert.equal(getterInvoked, false);
    assert.throws(() => checkConfig(Object.create({ inherited: true })), /plain JSON/);
  });

  it('rejects cycles, sparse or decorated arrays, symbol keys and omitted properties', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assert.throws(() => checkConfig(cyclic), /cycles/);
    assert.throws(() => checkConfig({ values: Array(2) }), /dense/);
    assert.throws(() => checkConfig({ values: [1, undefined] }), /JSON/);
    assert.throws(() => checkConfig({ values: Object.assign([1], { extra: 'lost' }) }), /extra properties/);
    assert.throws(() => checkConfig({ values: Object.assign(Array(1), { '4294967295': 'lost' }) }), /array properties/);
    assert.throws(() => checkConfig({ [Symbol('lost')]: 1 }), /symbol/);
    assert.throws(() => checkConfig(Object.defineProperty({}, 'hidden', { value: 1 })), /enumerable data/);
    assert.throws(() => checkConfig(Object.defineProperty({}, 'toJSON', { value: () => 'changed' })), /enumerable data/);
    assert.throws(() => knowledgeSchema.nodes.aiBlock.createAndFill({ scope: { invalid: new Map() } })?.check(), /JSON/);
  });
});

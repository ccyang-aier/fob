/**
 * Pure view-model tests of the review panel (S02): kind/scope derivation,
 * excerpts (including replacements and non-text blocks), document-ordered
 * rows, honest statistics, and the disabled matrix that keeps every
 * accept/reject control's reason in one place.
 */

import { describe, expect, test } from 'bun:test';
import { EditorState } from '@tiptap/pm/state';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions, newSuggestion, suggestText } from '@fob/shared/knowledge/schema/suggestions';
import type { SuggestionMetadata } from '@fob/shared/knowledge/schema/suggestions';
import { reviewActionsView, reviewRows, reviewStats, suggestionExcerpt, suggestionKindOf, suggestionScopeOf } from './review-model';

const createdAt = '2026-09-26T06:00:00.000Z';
const s = (suggestionId: string, author: string): SuggestionMetadata => newSuggestion(author, { suggestionId, createdAt });

function paragraph(id: string, text: string) {
  return knowledgeSchema.nodes.paragraph.create({ blockId: id }, knowledgeSchema.text(text));
}

function stateOf(...nodes: ReturnType<typeof paragraph>[]) {
  return EditorState.create({ schema: knowledgeSchema, doc: knowledgeSchema.nodes.doc.create(null, nodes) });
}

/** One text proposal applied to a fresh single-paragraph document. */
function proposed(text: string, from: number, to: number, replacement: string, author = 'agent:task_1') {
  const initial = stateOf(paragraph('p', text));
  return initial.apply(suggestText(initial, { from, to, text: replacement, suggestion: s('proposal', author) })).doc;
}

describe('suggestion kind and scope', () => {
  test('insert, delete and replace are derived from the range types', () => {
    expect(suggestionKindOf(collectSuggestions(proposed('abc', 3, 3, 'NEW'))[0])).toBe('insert');
    expect(suggestionKindOf(collectSuggestions(proposed('abc', 1, 3, ''))[0])).toBe('delete');
    expect(suggestionKindOf(collectSuggestions(proposed('abc', 1, 4, 'xyz'))[0])).toBe('replace');
  });

  test('node annotations are block scope, marks are text scope', () => {
    const insert = knowledgeSchema.marks.suggestion_insert.create(s('p-insert', 'agent:task_1'));
    const marked = knowledgeSchema.nodes.paragraph.create({ blockId: 'p' }, knowledgeSchema.text('文字', [insert]));
    const image = knowledgeSchema.nodes.image.create({
      blockId: 'img',
      annotations: [{ type: 'suggestion_insert', attrs: s('img-insert', 'agent:task_1') }],
    });
    const doc = knowledgeSchema.nodes.doc.create(null, [marked, image]);
    const summaries = collectSuggestions(doc);
    expect(summaries.map((summary) => summary.suggestionId)).toEqual(['p-insert', 'img-insert']);
    expect(suggestionScopeOf(summaries[0])).toBe('text');
    expect(suggestionScopeOf(summaries[1])).toBe('block');
  });
});

describe('excerpt', () => {
  test('insert shows the added text, replace shows 旧 → 新', () => {
    expect(suggestionExcerpt(proposed('abc', 3, 3, 'def'), collectSuggestions(proposed('abc', 3, 3, 'def'))[0])).toBe('def');
    const swapDoc = proposed('abc', 1, 4, 'xyz');
    expect(suggestionExcerpt(swapDoc, collectSuggestions(swapDoc)[0])).toBe('abc → xyz');
  });

  test('a non-text block names its type; long text is clipped', () => {
    const image = knowledgeSchema.nodes.image.create({
      blockId: 'img',
      annotations: [{ type: 'suggestion_delete', attrs: s('img-delete', 'agent:task_1') }],
    });
    const doc = knowledgeSchema.nodes.doc.create(null, [paragraph('p', '前'), image]);
    expect(suggestionExcerpt(doc, collectSuggestions(doc)[0])).toBe('图片');

    const longDoc = proposed('x'.repeat(60), 1, 1, 'y'.repeat(60));
    const excerpt = suggestionExcerpt(longDoc, collectSuggestions(longDoc)[0]);
    expect(excerpt.length).toBe(41);
    expect(excerpt.endsWith('…')).toBe(true);
  });
});

/** Finds the PM range of a needle inside one text node (positions are searched, never hand-counted). */
function textRangeOf(doc: ReturnType<typeof stateOf>['doc'], needle: string): { from: number; to: number } {
  let found: { from: number; to: number } | null = null;
  doc.descendants((node, pos) => {
    if (found || !node.isText || !node.text?.includes(needle)) return;
    const offset = node.text.indexOf(needle);
    found = { from: pos + offset, to: pos + offset + needle.length };
  });
  if (!found) throw new Error(`needle not found: ${needle}`);
  return found;
}

/**
 * A realistic three-author page: an agent insertion, a human replacement and
 * an MCP-proposed image block, all outstanding at once.
 */
function reviewFixture() {
  let state = stateOf(paragraph('p', 'abcdef'), paragraph('q', '目标文字'), paragraph('r', '收尾'));
  state = state.apply(suggestText(state, { from: 7, to: 7, text: '新增', suggestion: s('s-insert', 'agent:task_1') }));
  const replaced = textRangeOf(state.doc, '目标文字');
  state = state.apply(suggestText(state, { from: replaced.from, to: replaced.to, text: '替换', suggestion: s('s-replace', 'user:王五') }));

  const image = knowledgeSchema.nodes.image.create({
    blockId: 'img',
    annotations: [{ type: 'suggestion_insert', attrs: s('s-block', 'mcp:Claude%20Desktop:call_2') }],
  });
  const doc = knowledgeSchema.nodes.doc.create(null, [...state.doc.content.content, image]);
  return { doc, replaced };
}

describe('rows and stats', () => {
  test('rows carry author, kind, time label, excerpt and the uppermost anchor in document order', () => {
    const { doc, replaced } = reviewFixture();
    const rows = reviewRows(collectSuggestions(doc), doc);
    expect(rows.map((row) => row.suggestionId)).toEqual(['s-insert', 's-replace', 's-block']);
    expect(rows[0].kind).toBe('insert');
    expect(rows[0].scope).toBe('text');
    expect(typeof rows[0].createdAtLabel).toBe('string');
    expect(rows[0].author.kind).toBe('agent');
    expect(rows[0].author.label).toBe('AI 助手');
    expect(rows[0].excerpt).toBe('新增');
    expect(rows[0].anchor).toEqual({ from: 7, to: 9 });
    expect(rows[1].kind).toBe('replace');
    expect(rows[1].excerpt).toBe('目标文字 → 替换');
    expect(rows[1].author).toMatchObject({ kind: 'human', label: '王五' });
    // A fragmented suggestion anchors at its uppermost (deleted) range.
    expect(rows[1].anchor).toEqual({ from: replaced.from, to: replaced.to });
    expect(rows[2].kind).toBe('insert');
    expect(rows[2].scope).toBe('block');
    expect(rows[2].author).toMatchObject({ kind: 'mcp', label: 'Claude Desktop' });
  });

  test('stats count kinds, block scope and per-author totals', () => {
    const stats = reviewStats(collectSuggestions(reviewFixture().doc));
    expect(stats).toMatchObject({ total: 3, inserts: 2, deletes: 0, replaces: 1, blockScoped: 1 });
    expect(stats.authors.map(({ badge, count }) => [badge.label, count]).sort()).toEqual([
      ['AI 助手', 1],
      ['Claude Desktop', 1],
      ['王五', 1],
    ]);
  });
});

describe('reviewActionsView', () => {
  test('readonly refuses everything with the reason; empty is disabled; healthy docs are enabled', () => {
    const readonly = reviewActionsView({ editable: false, total: 3 });
    expect(readonly.canDecide).toBe(false);
    expect(readonly.canDecideAll).toBe(false);
    expect(readonly.disabledReason).toContain('只读');
    expect(reviewActionsView({ editable: true, total: 0 }).canDecide).toBe(false);
    expect(reviewActionsView({ editable: true, total: 1 })).toEqual({ canDecide: true, canDecideAll: true, disabledReason: null });
  });
});

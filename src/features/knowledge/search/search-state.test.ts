import { describe, expect, test } from 'bun:test';
import type { HybridSearchHit } from '@fob/shared/knowledge/search';
import { initialSearchState, searchReducer, searchKeyboardAction, describeVectorLeg, describeRerank } from './search-state';

const hit = (blockId: string): HybridSearchHit => ({
  pageId: 'p1', blockId, blockType: 'paragraph', titlePath: '根 > 子页', snippet: `片段 ${blockId}`,
  sources: blockId === 'b1' ? ['keyword'] : ['keyword', 'vector'],
  keywordScore: 1.5, semanticScore: blockId === 'b2' ? 0.8 : null, rrfScore: 0.03, rerankScore: null,
});

describe('search panel state', () => {
  test('stale query results never land; supersede keeps the newest query id', () => {
    let state = searchReducer(initialSearchState, { type: 'submit', queryId: 7 });
    state = searchReducer(state, { type: 'results', queryId: 6, hits: [hit('stale')], vectorLeg: null, rerank: null });
    expect(state.phase).toBe('loading');
    state = searchReducer(state, { type: 'results', queryId: 7, hits: [hit('b1'), hit('b2')], vectorLeg: null, rerank: null });
    expect(state.phase).toBe('results');
    expect(state.hits.length).toBe(2);
    expect(state.cursor).toBe(0);
    // 迟到的失败同样被忽略。
    state = searchReducer(state, { type: 'failed', queryId: 6, reason: 'LATE' });
    expect(state.phase).toBe('results');
  });

  test('empty results and failures map to dedicated phases', () => {
    let state = searchReducer(initialSearchState, { type: 'submit', queryId: 1 });
    state = searchReducer(state, { type: 'results', queryId: 1, hits: [], vectorLeg: null, rerank: null });
    expect(state.phase).toBe('empty');
    state = searchReducer(state, { type: 'submit', queryId: 2 });
    state = searchReducer(state, { type: 'failed', queryId: 2, reason: 'NETWORK' });
    expect(state.phase).toBe('error');
    expect(state.errorReason).toBe('NETWORK');
  });

  test('keyboard traversal clamps at both ends and Enter/Escape map to intents', () => {
    let state = searchReducer(initialSearchState, { type: 'submit', queryId: 1 });
    state = searchReducer(state, { type: 'results', queryId: 1, hits: [hit('b1'), hit('b2'), hit('b3')], vectorLeg: null, rerank: null });
    state = searchReducer(state, searchKeyboardAction('ArrowDown') as never);
    state = searchReducer(state, searchKeyboardAction('ArrowDown') as never);
    expect(state.cursor).toBe(2);
    state = searchReducer(state, searchKeyboardAction('ArrowDown') as never);
    expect(state.cursor).toBe(2);
    state = searchReducer(state, searchKeyboardAction('ArrowUp') as never);
    expect(state.cursor).toBe(1);
    expect(searchKeyboardAction('Enter')).toBe('open');
    const reset = searchReducer(state, searchKeyboardAction('Escape') as never);
    expect(reset.phase).toBe('idle');
    expect(searchKeyboardAction('a')).toBeNull();
  });

  test('degradation copy explains vector leg and rerank states', () => {
    expect(describeVectorLeg({ status: 'used', model: 'all-minilm' })).toContain('all-minilm');
    expect(describeVectorLeg({ status: 'skipped', reason: 'no_active_model' })).toContain('未启用');
    expect(describeVectorLeg(null)).toBeNull();
    expect(describeRerank({ status: 'used' })).toBe('已重排');
    expect(describeRerank({ status: 'skipped', reason: 'not_configured' })).toBe('未重排');
  });
});

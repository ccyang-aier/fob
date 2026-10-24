import { createTranslator } from '@/lib/i18n';
import { knowledgeMessages } from './search-state.messages';

/**
 * Search panel state (H05): one debounced hybrid query at a time, late
 * responses discarded, cancellable; keyboard traversal over validated hits.
 */
import type { HybridSearchHit } from '@fob/shared/knowledge/search';

const knowledgeT = createTranslator(knowledgeMessages);

export type SearchPhase = 'idle' | 'loading' | 'error' | 'empty' | 'results';

export interface SearchViewState {
  phase: SearchPhase;
  hits: readonly HybridSearchHit[];
  cursor: number;
  errorReason: string | null;
  /** 服务端降级状态(向量腿/重排),如实展示。 */
  vectorLeg: string | null;
  rerank: string | null;
  queryId: number;
}

export const initialSearchState: SearchViewState = {
  phase: 'idle',
  hits: [],
  cursor: 0,
  errorReason: null,
  vectorLeg: null,
  rerank: null,
  queryId: 0,
};

export type SearchAction =
  | { type: 'submit'; queryId: number }
  | {
      type: 'results';
      queryId: number;
      hits: readonly HybridSearchHit[];
      vectorLeg: string | null;
      rerank: string | null;
    }
  | { type: 'failed'; queryId: number; reason: string }
  | { type: 'reset' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'cursor'; index: number };

/** Pure reducer: stale queryIds (cancelled or superseded) never land. */
export function searchReducer(state: SearchViewState, action: SearchAction): SearchViewState {
  switch (action.type) {
    case 'reset':
      return initialSearchState;
    case 'submit':
      return { ...initialSearchState, phase: 'loading', queryId: action.queryId };
    case 'results':
      if (action.queryId !== state.queryId) return state;
      return {
        ...state,
        phase: action.hits.length ? 'results' : 'empty',
        hits: action.hits,
        cursor: 0,
        vectorLeg: action.vectorLeg,
        rerank: action.rerank,
      };
    case 'failed':
      if (action.queryId !== state.queryId) return state;
      return { ...state, phase: 'error', errorReason: action.reason };
    case 'move': {
      if (state.phase !== 'results' || !state.hits.length) return state;
      const next = state.cursor + action.delta;
      return { ...state, cursor: Math.max(0, Math.min(state.hits.length - 1, next)) };
    }
    case 'cursor':
      if (state.phase !== 'results' || action.index < 0 || action.index >= state.hits.length)
        return state;
      return { ...state, cursor: action.index };
  }
}

/** 键盘语义:↑/↓ 移动,Enter 打开当前命中,Esc 重置。 */
export function searchKeyboardAction(key: string): SearchAction | 'open' | null {
  if (key === 'ArrowDown') return { type: 'move', delta: 1 };
  if (key === 'ArrowUp') return { type: 'move', delta: -1 };
  if (key === 'Enter') return 'open';
  if (key === 'Escape') return { type: 'reset' };
  return null;
}

export function describeVectorLeg(leg: unknown): string | null {
  if (leg && typeof leg === 'object' && 'status' in leg) {
    const value = leg as { status: string; model?: string };
    return value.status === 'used'
      ? knowledgeT('semanticSearchValue', { v0: value.model ?? knowledgeT('currentModel') })
      : knowledgeT('semanticSearchUnavailableNoModelConfigured');
  }
  return null;
}

export function describeRerank(rerank: unknown): string | null {
  if (rerank && typeof rerank === 'object' && 'status' in rerank) {
    const value = rerank as { status: string };
    return value.status === 'used' ? knowledgeT('reranked') : knowledgeT('notReranked');
  }
  return null;
}

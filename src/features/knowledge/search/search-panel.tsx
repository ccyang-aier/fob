'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './search-panel.messages';
/**
 * 混合检索面板(H05):一次一个防抖查询、可取消、迟到的响应一律丢弃;
 * ↑↓ 遍历、Enter 打开当前命中、Esc 重置;命中带标题路径与来源徽标,
 * 点击/回车回调 (pageId, blockId) 供树定位与块高亮。
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import {
  searchReducer,
  initialSearchState,
  searchKeyboardAction,
  describeVectorLeg,
  describeRerank,
} from './search-state';
import type { SearchViewState } from './search-state';
import { createKnowledgeSearchApi } from './search-api';

const DEBOUNCE_MS = 220;

export interface KnowledgeSearchPanelProps {
  knowledgeBaseId: string;
  origin: string;
  onOpenHit: (hit: { pageId: string; blockId: string }) => void;
  className?: string;
}

export function KnowledgeSearchPanel({
  knowledgeBaseId,
  origin,
  onOpenHit,
  className,
}: KnowledgeSearchPanelProps) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const [state, dispatch] = useReducer(searchReducer, initialSearchState);
  const [term, setTerm] = useState('');
  const api = useMemo(() => createKnowledgeSearchApi({ origin }), [origin]);
  const controllerRef = useRef<AbortController | null>(null);
  const queryIdRef = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) {
      controllerRef.current?.abort();
      dispatch({ type: 'reset' });
      return;
    }
    const timer = setTimeout(() => {
      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      const queryId = ++queryIdRef.current;
      dispatch({ type: 'submit', queryId });
      api
        .search({ knowledgeBaseId, query }, controller.signal)
        .then((outcome) => dispatch({ type: 'results', queryId, ...outcome }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          dispatch({
            type: 'failed',
            queryId,
            reason: error instanceof Error ? error.message : 'NETWORK',
          });
        });
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, knowledgeBaseId, api]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const openCursor = useCallback(() => {
    const hit = state.hits[state.cursor];
    if (hit) onOpenHit({ pageId: hit.pageId, blockId: hit.blockId });
  }, [state.hits, state.cursor, onOpenHit]);

  useEffect(() => {
    const item = listRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${state.cursor}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [state.cursor]);

  return (
    <div className={`flex min-h-0 flex-col gap-2 ${className ?? ''}`} role="search">
      <input
        type="search"
        value={term}
        onChange={(event) => setTerm(event.target.value)}
        onKeyDown={(event) => {
          const action = searchKeyboardAction(event.key);
          if (!action) return;
          event.preventDefault();
          if (action === 'open') openCursor();
          else dispatch(action);
        }}
        placeholder={knowledgeT('searchPagesAndBlocks')}
        aria-label={knowledgeT('hybridSearch')}
        className="w-full rounded-md border border-line bg-overlay px-3 py-2 text-sm text-ink outline-none transition focus:border-accent"
      />
      <StatusLine state={state} />
      <div
        ref={listRef}
        className="min-h-0 flex-1 overflow-y-auto"
        role="listbox"
        aria-label={knowledgeT('searchResults')}
      >
        {state.phase === 'results' &&
          state.hits.map((hit, index) => (
            <button
              key={`${hit.pageId}:${hit.blockId}`}
              type="button"
              role="option"
              aria-selected={index === state.cursor}
              data-search-index={index}
              onMouseEnter={() => dispatch({ type: 'cursor', index })}
              onClick={() => onOpenHit({ pageId: hit.pageId, blockId: hit.blockId })}
              className={`w-full rounded-md px-3 py-2 text-left transition ${index === state.cursor ? 'bg-overlay-active' : 'hover:bg-overlay'}`}
            >
              <span className="line-clamp-1 text-sm text-ink">
                {hit.titlePath || hit.snippet || hit.blockId}
              </span>
              <span className="mt-1 flex items-center gap-1">
                {hit.sources.map((source) => (
                  <span
                    key={source}
                    className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-ink"
                  >
                    {source === 'keyword' ? knowledgeT('keyword') : knowledgeT('semantic')}
                  </span>
                ))}
                {hit.rerankScore !== null && (
                  <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-accent-ink">
                    {knowledgeT('reranked')}
                  </span>
                )}
                <span className="line-clamp-1 text-xs text-muted">{hit.snippet}</span>
              </span>
            </button>
          ))}
        {state.phase === 'empty' && (
          <p className="px-3 py-6 text-center text-sm text-muted">
            {knowledgeT('noResultsTryDifferentKeywords')}
          </p>
        )}
        {state.phase === 'error' && (
          <p className="px-3 py-6 text-center text-sm text-err-ink">
            {knowledgeT('searchUnavailable')}
            {state.errorReason}
            {knowledgeT('pleaseRetryLater')}
          </p>
        )}
        {state.phase === 'idle' && (
          <p className="px-3 py-6 text-center text-sm text-muted">
            {knowledgeT('enterAtLeastTwoCharactersToSearch')}
          </p>
        )}
      </div>
    </div>
  );
}

function StatusLine({ state }: { state: SearchViewState }) {
  if (state.phase !== 'results') return null;
  const legs = [
    describeVectorLeg(
      state.vectorLeg
        ? { status: state.vectorLeg === 'skipped' ? 'skipped' : 'used', model: state.vectorLeg }
        : null,
    ),
    describeRerank({ status: state.rerank }),
  ].filter(Boolean);
  if (!legs.length) return null;
  return <p className="px-1 text-[10px] text-muted">{legs.join(' · ')}</p>;
}

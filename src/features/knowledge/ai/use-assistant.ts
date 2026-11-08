'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssistantConversation, AssistantModelSelection, PageScope } from '@fob/shared/knowledge/contracts';
import { usePageSessionState } from '@/lib/page-session-state';
import { assistantApi, AssistantRequestError } from './assistant-api';

const accessCodes = new Set(['access_changed', 'TARGET_NOT_ACCESSIBLE', 'FORBIDDEN', 'UNAUTHENTICATED', 'INSUFFICIENT_SCOPE']);
const accessFailure = (error: unknown) => error instanceof AssistantRequestError && accessCodes.has(error.code);

export function useAssistant(scope: PageScope, userId: string) {
  const root = [scope.knowledgeBaseId, 'knowledge', 'pages', 'assistant', userId] as const;
  const client = useQueryClient(), [id, setId] = usePageSessionState<string | null>('assistant-conversation', null);
  const [live, setLive] = useState<AssistantConversation | null>(null), [fetchBusy, setFetchBusy] = useState(false), [error, setError] = useState<string | null>(null), [truncated, setTruncated] = useState(false);
  const active = useRef(true), pending = useRef(false), controller = useRef<AbortController | null>(null), currentId = useRef(id);
  const mutations = useRef(new Set<AbortController>());
  const removing = useRef(new Set<string>()), applying = useRef(false);
  const stopping = useRef(false);
  useEffect(() => { currentId.current = id; }, [id]);
  const settings = useQuery({ queryKey: [...root, 'settings'], queryFn: ({ signal }) => assistantApi.settings(scope.knowledgeBaseId, signal) });
  const list = useQuery({ queryKey: [...root, 'list'], queryFn: ({ signal }) => assistantApi.list(scope.knowledgeBaseId, signal) });
  const thread = useQuery({ queryKey: [...root, id], enabled: Boolean(id), queryFn: ({ signal }) => assistantApi.get(scope.knowledgeBaseId, id!, signal), refetchInterval: query => fetchBusy ? false : query.state.data?.turns.at(-1)?.status === 'running' ? 1000 : 15000 });
  // Cached answers require a fresh authorization check when a panel mounts. Query
  // failures retain old data in TanStack Query, so never render that retained data.
  const denied = accessFailure(settings.error) || accessFailure(list.error) || accessFailure(thread.error) || Boolean(error && accessCodes.has(error));
  const conversation = denied ? null : live ?? (!thread.isError && thread.isFetchedAfterMount ? thread.data : null) ?? null;
  const remoteRunning = conversation?.turns.at(-1)?.status === 'running';
  const busy = fetchBusy || remoteRunning;
  useEffect(() => {
    if (!id || !accessFailure(thread.error) || !thread.data) return;
    // Keep the denied query/error state, but physically discard its old private
    // response. Removing an observed query would recreate it and retry forever.
    client.getQueryCache().find({ queryKey: [scope.knowledgeBaseId, 'knowledge', 'pages', 'assistant', userId, id], exact: true })?.setState({ data: undefined });
  }, [client, scope.knowledgeBaseId, userId, id, thread.error, thread.data]);
  useEffect(() => { active.current = true; const requests = mutations.current; return () => { active.current = false; controller.current?.abort(); for (const mutation of requests) mutation.abort(); }; }, []);
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: [scope.knowledgeBaseId, 'knowledge', 'pages', 'assistant', userId] }), [client, scope.knowledgeBaseId, userId]);
  useEffect(() => {
    const changed = (event: Event) => { const detail = (event as CustomEvent<{ knowledgeBaseId: string; userId: string }>).detail; if (detail?.knowledgeBaseId === scope.knowledgeBaseId && detail.userId === userId) void refresh(); };
    window.addEventListener('fob:assistant-settings-changed', changed);
    return () => window.removeEventListener('fob:assistant-settings-changed', changed);
  }, [scope.knowledgeBaseId, userId, refresh]);
  async function send(question: string, mode: 'document' | 'knowledgeBase', tier: 'fast' | 'smart', selection?: AssistantModelSelection | null, onStarted?: () => void) {
    if (pending.current || remoteRunning || applying.current || !question.trim()) return;
    pending.current = true; setFetchBusy(true); setError(null); setTruncated(false);
    const abort = new AbortController(); controller.current = abort;
    let result: AssistantConversation | null = conversation ? { ...conversation, turns: [...conversation.turns] } : null;
    let accepted = false;
    try {
      await assistantApi.ask(scope.knowledgeBaseId, { pageId: scope.pageId, ...(id ? { conversationId: id } : {}), ...(selection ? { selection } : {}), requestId: crypto.randomUUID(), question, mode, tier }, abort.signal, event => {
        if (!active.current || abort.signal.aborted) return;
        if (event.type === 'start') { setId(event.conversationId); currentId.current = event.conversationId; result = { id: event.conversationId, title: result?.title || question.slice(0, 60), updatedAt: event.turn.createdAt, turns: [...(result?.turns ?? []).filter(turn => turn.id !== event.turn.id), event.turn].slice(-20) }; if (!accepted) { accepted = true; onStarted?.(); } }
        if (event.type === 'sources') setTruncated(event.truncated);
        if (result && event.type === 'sources') { const last = result.turns.at(-1)!; result = { ...result, turns: [...result.turns.slice(0,-1), { ...last, sources: event.sources }] }; }
        if (result && event.type === 'tool') { const last = result.turns.at(-1)!, steps = last.toolSteps ?? []; result = { ...result, turns: [...result.turns.slice(0,-1), { ...last, toolSteps: [...steps.filter(step => step.id !== event.step.id), event.step].slice(-40) }] }; }
        if (result && event.type === 'delta') { const last = result.turns.at(-1)!; result = { ...result, turns: [...result.turns.slice(0, -1), { ...last, answer: last.answer + event.text }] }; }
        if (result && event.type === 'finish') result = { ...result, turns: [...result.turns.slice(0, -1), event.turn] };
        if (result) setLive({ ...result });
      });
    } catch (failure) {
      if (active.current) {
        setError(abort.signal.aborted ? null : failure instanceof AssistantRequestError ? failure.code : 'interrupted');
        if (accessFailure(failure)) {
          if (result) client.removeQueries({ queryKey: [...root, result.id], exact: true });
          result = null; setLive(null);
        }
        if (result) { const last = result.turns.at(-1); if (last?.status === 'running') { result = { ...result, turns: [...result.turns.slice(0,-1), { ...last, status: abort.signal.aborted ? 'cancelled' : 'failed', errorCode: abort.signal.aborted ? 'cancelled' : 'interrupted' }] }; setLive(result); } }
      }
    } finally {
      pending.current = false; controller.current = null;
      if (active.current) { setFetchBusy(false); if (result) { client.setQueryData([...root, result.id], result); setLive(null); } void refresh(); }
    }
  }
  async function stop() {
    // A conversation may not have emitted `start` yet. Aborting this transport
    // also reaches the server disconnect signal during that initial phase.
    controller.current?.abort();
    const target = currentId.current;
    if (!target || stopping.current) return;
    stopping.current = true;
    const abort = new AbortController(); mutations.current.add(abort);
    try {
      await assistantApi.cancel(scope.knowledgeBaseId, target, abort.signal);
      if (active.current && !abort.signal.aborted) await refresh();
    } catch (failure) {
      if (active.current && !abort.signal.aborted) setError(failure instanceof AssistantRequestError ? failure.code : 'interrupted');
    } finally { stopping.current = false; mutations.current.delete(abort); }
  }
  function select(next: string | null) { if (pending.current) return; currentId.current = next; setLive(null); setError(null); setId(next); setTruncated(false); }
  async function remove(target: string) {
    if (removing.current.has(target)) return;
    const abort = new AbortController(); mutations.current.add(abort); removing.current.add(target);
    try {
      await assistantApi.remove(scope.knowledgeBaseId, target, abort.signal);
      if (!active.current || abort.signal.aborted) return;
      client.removeQueries({ queryKey: [...root, target], exact: true });
      if (currentId.current === target) select(null);
      await refresh();
    } finally { mutations.current.delete(abort); removing.current.delete(target); }
  }
  async function apply(turnId: string) {
    const target = currentId.current;
    if (!target || applying.current) return;
    const abort = new AbortController(); mutations.current.add(abort); applying.current = true;
    try {
      const result = await assistantApi.apply(scope.knowledgeBaseId, target, turnId, scope.pageId, abort.signal);
      if (!result.applied) throw new AssistantRequestError('answer_already_applied');
      if (!active.current || abort.signal.aborted) return;
      if (currentId.current === target) setLive(null);
      await refresh();
    } finally { mutations.current.delete(abort); applying.current = false; }
  }
  return { settings, list, thread, conversation, conversationId: id, busy, error, truncated, send, stop, select, remove, apply, refresh };
}

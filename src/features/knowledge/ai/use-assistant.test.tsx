import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
import type { QueryClient as Client } from '@tanstack/react-query';
import type { Root } from 'react-dom/client';
import type { AssistantConversation, AssistantStreamEvent, PageScope } from '@fob/shared/knowledge/contracts';
import type { useAssistant as UseAssistant } from './use-assistant';

const scope: PageScope = { knowledgeBaseId: '10000000-0000-4000-8000-000000000001', pageId: '10000000-0000-4000-8000-000000000002' };
const one = '10000000-0000-4000-8000-000000000003', two = '10000000-0000-4000-8000-000000000004';
const prefix = [scope.knowledgeBaseId, 'knowledge', 'pages', 'assistant', 'alice'];
function deferred<T>() { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function conversation(id: string): AssistantConversation {
  return { id, title: 'Private question', updatedAt: new Date().toISOString(), turns: [{ id: crypto.randomUUID(), question: 'Private question', answer: 'Private answer', pageId: scope.pageId, mode: 'document', status: 'done', sources: [], errorCode: null, createdAt: new Date().toISOString(), appliedPageId: null, model: null, inputTokens: null, outputTokens: null }] };
}
class RequestError extends Error { constructor(readonly code: string) { super(code); } }
let browser: Window, root: Root, client: Client, useAssistant: typeof UseAssistant, value: ReturnType<typeof UseAssistant>;
let QueryClient: typeof import('@tanstack/react-query').QueryClient, QueryClientProvider: typeof import('@tanstack/react-query').QueryClientProvider;
let gets: { id: string; signal?: AbortSignal; pending: ReturnType<typeof deferred<AssistantConversation>> }[];
let ask: { signal: AbortSignal; emit(event: AssistantStreamEvent): void; pending: ReturnType<typeof deferred<void>> } | null;
let deleted: ReturnType<typeof deferred<Response>>, deletionSignal: AbortSignal | undefined;
let applied: ReturnType<typeof deferred<{ applied: boolean; pageId: string }>>, applicationSignal: AbortSignal | undefined;
let cancelCalls: string[];
function Capture() { const current = useAssistant(scope, 'alice'); useEffect(() => { value = current; }, [current]); return null; }
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  ({ QueryClient, QueryClientProvider } = await import('@tanstack/react-query'));
  mock.module('./assistant-api', () => ({ AssistantRequestError: RequestError, assistantApi: {
    settings: async () => ({ ready: true }), list: async () => [],
    get: async (_base: string, id: string, signal?: AbortSignal) => { const pending = deferred<AssistantConversation>(); gets.push({ id, signal, pending }); return pending.promise; },
    ask: async (_base: string, _input: unknown, signal: AbortSignal, emit: (event: AssistantStreamEvent) => void) => { const pending = deferred<void>(); ask = { signal, emit, pending }; signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true }); return pending.promise; },
    cancel: async (_base: string, id: string) => { cancelCalls.push(id); return new Response('{}'); },
    remove: async (_base: string, _id: string, signal?: AbortSignal) => { deletionSignal = signal; return deleted.promise; },
    apply: async (_base: string, _id: string, _turn: string, _page: string, signal?: AbortSignal) => { applicationSignal = signal; return applied.promise; },
  } }));
  useAssistant = (await import('./use-assistant')).useAssistant;
  const { createRoot } = await import('react-dom/client'); const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
}, 20000);
beforeEach(async () => {
  await act(async () => root.render(null)); client?.clear();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  gets = []; ask = null; cancelCalls = []; deleted = deferred<Response>(); applied = deferred<{ applied: boolean; pageId: string }>(); deletionSignal = applicationSignal = undefined;
});
afterAll(async () => { await act(async () => root.unmount()); client.clear(); await browser.happyDOM.abort(); mock.restore(); });
async function flush() { await new Promise(done => setTimeout(done, 10)); }
async function mount() { await act(async () => { root.render(<QueryClientProvider client={client}><Capture /></QueryClientProvider>); await flush(); }); }
async function select(id: string) { await act(async () => value.select(id)); }
async function publish(id: string) { await act(async () => { gets.findLast(request => request.id === id)!.pending.resolve(conversation(id)); await flush(); }); }

test('Stop aborts the active request even before the server emits start, and rejects late deltas', async () => {
  await mount(); let sending!: Promise<void>;
  await act(async () => { sending = value.send('question', 'document', 'fast'); });
  expect(ask!.signal.aborted).toBe(false);
  await act(async () => { await value.stop(); await sending; });
  expect(ask!.signal.aborted).toBe(true); expect(value.busy).toBe(false); expect(cancelCalls).toHaveLength(0);
  await act(async () => ask!.emit({ type: 'start', conversationId: one, turn: conversation(one).turns[0]! }));
  expect(value.conversationId).toBeNull(); expect(value.conversation).toBeNull();
});

test('deleting one conversation cannot clear a different conversation selected during the request', async () => {
  await mount(); await select(one); await publish(one); let removing!: Promise<void>;
  await act(async () => { removing = value.remove(one); });
  await select(two); await publish(two);
  await act(async () => { deleted.resolve(new Response('{}')); await flush(); gets.findLast(request => request.id === two)!.pending.resolve(conversation(two)); await removing; await flush(); });
  expect(value.conversationId).toBe(two); expect(value.conversation?.id).toBe(two);
  expect(client.getQueryData([...prefix, one])).toBeUndefined();
});

test('cached private answers wait for fresh authorization and disappear after a failed permission check', async () => {
  client.setQueryData([...prefix, one], conversation(one));
  await mount(); await select(one); expect(value.conversation).toBeNull();
  await publish(one); expect(value.conversation?.turns[0]?.answer).toBe('Private answer');
  await act(async () => { void client.invalidateQueries({ queryKey: [...prefix, one] }); });
  await act(async () => { gets.at(-1)!.pending.reject(new RequestError('access_changed')); await flush(); });
  expect(value.thread.isError).toBe(true); expect(value.conversation).toBeNull();
  expect(client.getQueryData([...prefix, one])).toBeUndefined();
});

test('permission loss while streaming removes the partial answer from display and query cache', async () => {
  await mount(); let sending!: Promise<void>;
  await act(async () => { sending = value.send('question', 'document', 'fast'); });
  await act(async () => { ask!.emit({ type: 'start', conversationId: one, turn: { ...conversation(one).turns[0]!, status: 'running', answer: '' } }); ask!.emit({ type: 'delta', text: 'Sensitive partial' }); });
  expect(value.conversation?.turns.at(-1)?.answer).toBe('Sensitive partial');
  await act(async () => { ask!.pending.reject(new RequestError('access_changed')); await sending; await flush(); });
  expect(value.conversation).toBeNull(); expect(client.getQueryData([...prefix, one])).toBeUndefined();
});

test('unmount aborts conversation mutations and skips late selection or cache writes', async () => {
  await mount(); await select(one); await publish(one); let removing!: Promise<void>, applying!: Promise<void>;
  await act(async () => { removing = value.remove(one); applying = value.apply(conversation(one).turns[0]!.id); });
  await act(async () => root.render(null));
  expect(deletionSignal?.aborted).toBe(true); expect(applicationSignal?.aborted).toBe(true);
  await act(async () => { deleted.resolve(new Response('{}')); applied.resolve({ applied: true, pageId: scope.pageId }); await Promise.all([removing, applying]); });
  expect(client.getQueryData<AssistantConversation>([...prefix, one])?.turns[0]?.appliedPageId).toBeNull();
});

test('a restored running conversation stays busy and polls until the server returns a terminal turn', async () => {
  await mount(); await select(one);
  const running = conversation(one); running.turns[0]!.status = 'running';
  await act(async () => { gets.at(-1)!.pending.resolve(running); await flush(); });
  expect(value.busy).toBe(true); expect(ask).toBeNull();
  await act(async () => { await new Promise(done => setTimeout(done, 1100)); });
  expect(gets.filter(request => request.id === one)).toHaveLength(2);
  await publish(one); expect(value.busy).toBe(false);
});

test('Stop works for restored running conversations and refreshes their durable state', async () => {
  await mount(); await select(one);
  const running = conversation(one); running.turns[0]!.status = 'running';
  await act(async () => { gets.at(-1)!.pending.resolve(running); await flush(); });
  let stopping!: Promise<void>;
  await act(async () => { stopping = value.stop(); await flush(); });
  expect(cancelCalls).toEqual([one]);
  const stopped = conversation(one); stopped.turns[0]!.status = 'cancelled';
  await act(async () => { gets.at(-1)!.pending.resolve(stopped); await stopping; await flush(); });
  expect(value.busy).toBe(false); expect(value.conversation?.turns[0]?.status).toBe('cancelled');
});

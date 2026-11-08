import { afterEach, expect, test } from 'bun:test';
import type { AssistantAsk, AssistantConversation, AssistantSettings, AssistantStreamEvent, AssistantTurn } from '@fob/shared/knowledge/contracts';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { CompanionConversationSession } from './conversation-session';
import { readConversationPointer, saveConversationPointer } from './conversation-pointer';
import type { CompanionChatScope } from './types';

const uuid = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const scope: CompanionChatScope = { userId: uuid(1), knowledgeBaseId: uuid(2), pageId: uuid(3) };
const timestamp = '2026-11-09T00:00:00.000Z';
const settings: AssistantSettings = { provider: 'default', model: 'fast', endpoint: null, ready: true, hasCredential: false, ollamaAvailable: false, platformModel: 'fast', calls: 0, inputTokens: 0, outputTokens: 0 };
function turn(status: AssistantTurn['status'] = 'running', answer = '', overrides: Partial<AssistantTurn> = {}): AssistantTurn {
  return { id: uuid(5), question: 'Question', answer, mode: 'document', pageId: scope.pageId, status, sources: [], errorCode: null, createdAt: timestamp, appliedPageId: null, model: 'fast', inputTokens: null, outputTokens: null, ...overrides };
}
const conversation = (id = uuid(4), turns = [turn('done', 'Stored answer')]): AssistantConversation => ({ id, title: `Thread ${id}`, updatedAt: timestamp, turns });
function deferred<T>() { let resolve!: (value: T | PromiseLike<T>) => void, reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
type Ask = { base: string; input: AssistantAsk; signal: AbortSignal; emit(event: AssistantStreamEvent): void; pending: ReturnType<typeof deferred<void>> };
const sessions: CompanionConversationSession[] = [];
afterEach(() => { for (const item of sessions.splice(0)) item.dispose(); });
const flush = () => new Promise<void>(done => setTimeout(done, 5));

function harness() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const asks: Ask[] = [], gets: { base: string; id: string; signal?: AbortSignal }[] = [], cancels: string[] = [], removals: string[] = [], settingCalls: { base: string; signal?: AbortSignal }[] = [];
  const data = new Map<string, AssistantConversation>();
  const behavior: {
    settings(base: string, signal?: AbortSignal): Promise<AssistantSettings>;
    get(base: string, id: string, signal?: AbortSignal): Promise<AssistantConversation>;
    remove(base: string, id: string, signal?: AbortSignal): Promise<Response>;
    cancel(base: string, id: string, signal?: AbortSignal): Promise<Response>;
  } = {
    settings: () => Promise.resolve(settings),
    get: (_base, id) => data.has(id) ? Promise.resolve(data.get(id)!) : Promise.reject(new AssistantRequestError('conversation_not_found')),
    remove: (_base, id) => { data.delete(id); return Promise.resolve(new Response(null, { status: 204 })); },
    cancel: () => Promise.resolve(new Response(null, { status: 204 })),
  };
  const api: typeof assistantApi = { ...assistantApi,
    settings: (base, signal) => { settingCalls.push({ base, signal }); return behavior.settings(base, signal); },
    list: async () => [...data.values()].map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
    get: (base, id, signal) => { gets.push({ base, id, signal }); return behavior.get(base, id, signal); },
    remove: (base, id, signal) => { removals.push(id); return behavior.remove(base, id, signal); },
    cancel: (base, id, signal) => { cancels.push(id); return behavior.cancel(base, id, signal); },
    ask: (base, input, signal, emit) => { const pending = deferred<void>(); asks.push({ base, input, signal, emit, pending }); signal.addEventListener('abort', () => pending.reject(new DOMException('Aborted', 'AbortError')), { once: true }); return pending.promise; },
  };
  const session = new CompanionConversationSession(api, storage); sessions.push(session);
  return { session, storage, asks, gets, cancels, removals, settingCalls, data, behavior, async open(value: CompanionChatScope = scope) { session.configure(value, true); await flush(); } };
}
function start(request: Ask, id = uuid(4), value = turn()) { request.emit({ type: 'start', conversationId: id, turn: value }); }
function finish(request: Ask, value = turn('done', 'Generated answer')) { request.emit({ type: 'finish', turn: value }); request.pending.resolve(); }

test('loads lazily without providers and sends explicit KB null page using the configured fast model', async () => {
  const h = harness(); h.session.configure({ ...scope, pageId: null }, false);
  await flush(); expect(h.settingCalls).toHaveLength(0);
  await h.open({ ...scope, pageId: null }); expect(h.session.getSnapshot().ready).toBe(true);
  const sending = h.session.send('Hello', 'knowledgeBase');
  expect(h.asks).toHaveLength(1); expect(h.asks[0].input).toMatchObject({ pageId: null, mode: 'knowledgeBase', tier: 'fast', question: 'Hello' });
  start(h.asks[0], uuid(4), turn('running', '', { mode: 'knowledgeBase', pageId: null })); finish(h.asks[0], turn('done', 'Hello back', { mode: 'knowledgeBase', pageId: null })); await sending;
  expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Hello back');
});

test('deduplicates sends, acknowledges start once, and folds sources/tools/deltas/final state', async () => {
  const h = harness(); await h.open(); let acknowledgements = 0;
  const sending = h.session.send('Question', 'document', () => acknowledgements++);
  await h.session.send('Duplicate', 'document'); expect(h.asks).toHaveLength(1); expect(h.session.getSnapshot().busy).toBe(true);
  const ask = h.asks[0]; start(ask); ask.emit({ type: 'delta', text: 'Part ' }); start(ask);
  expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Part '); expect(acknowledgements).toBe(1);
  ask.emit({ type: 'sources', truncated: true, sources: [{ id: 1, pageId: uuid(3), blockId: 'intro', title: 'Source', excerpt: 'Excerpt' }] });
  ask.emit({ type: 'tool', step: { id: 'read', name: 'read_page', status: 'running', summary: 'Reading', durationMs: null } });
  ask.emit({ type: 'tool', step: { id: 'read', name: 'read_page', status: 'done', summary: 'Read', durationMs: 10 } });
  ask.emit({ type: 'delta', text: 'two' });
  expect(h.session.getSnapshot().conversation?.turns[0]).toMatchObject({ answer: 'Part two', sources: [{ id: 1 }], toolSteps: [{ id: 'read', status: 'done' }] });
  expect(h.session.getSnapshot().truncated).toBe(true);
  finish(ask, turn('done', 'Canonical final')); await sending;
  expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Canonical final'); expect(h.session.getSnapshot().busy).toBe(false);
});

test('a pre-start failure never clears the draft and a transport interruption retains partial content', async () => {
  const h = harness(); await h.open(); let ack = 0;
  const rejected = h.session.send('Draft', 'document', () => ack++); h.asks[0].pending.reject(new AssistantRequestError('configuration')); await rejected;
  expect(ack).toBe(0); expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().errorCode).toBe('configuration');
  const interrupted = h.session.send('Draft', 'document', () => ack++); const ask = h.asks[1]; start(ask); ask.emit({ type: 'delta', text: 'Keep this partial' }); ask.pending.reject(new AssistantRequestError('interrupted')); await interrupted;
  expect(ack).toBe(1); expect(h.session.getSnapshot().conversation?.turns[0]).toMatchObject({ answer: 'Keep this partial', status: 'failed', errorCode: 'interrupted' });
  expect(h.session.getSnapshot().busy).toBe(false);
});

test('stop works before start and late events cannot create a conversation or acknowledge input', async () => {
  const h = harness(); await h.open(); let ack = 0;
  const pending = h.session.send('Do not clear', 'document', () => ack++), ask = h.asks[0];
  await h.session.stop(); await pending;
  expect(ask.signal.aborted).toBe(true); expect(h.session.getSnapshot().busy).toBe(false); expect(h.cancels).toHaveLength(0);
  start(ask); ask.emit({ type: 'delta', text: 'Late private answer' }); finish(ask);
  expect(ack).toBe(0); expect(h.session.getSnapshot().conversation).toBeNull();
});

test('closing a live chat keeps the accepted stream and re-opening validates completed history afresh', async () => {
  const h = harness(); await h.open(); const pending = h.session.send('Question', 'document'), ask = h.asks[0]; start(ask);
  h.session.configure(scope, false); expect(ask.signal.aborted).toBe(false); ask.emit({ type: 'delta', text: 'Still receiving' });
  const final = conversation(uuid(4), [turn('done', 'Finished in background')]); h.data.set(final.id, final); finish(ask, final.turns[0]); await pending;
  expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Finished in background');
  const loading = deferred<AssistantConversation>(); h.behavior.get = () => loading.promise;
  h.session.configure(scope, true); expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().loading).toBe(true); expect(h.session.getSnapshot().conversations).toEqual([]); expect(h.session.getSnapshot().settings).toBeNull();
  loading.resolve(final); await flush(); expect(h.session.getSnapshot().conversation?.id).toBe(final.id);
});

test('scope transitions abort old work and cannot publish previous private answers or settings', async () => {
  const h = harness(); await h.open(); const pending = h.session.send('Private question', 'document'), ask = h.asks[0]; start(ask); ask.emit({ type: 'delta', text: 'Private answer' });
  const oldSettings = deferred<AssistantSettings>(); h.behavior.settings = base => base === uuid(2) ? oldSettings.promise : Promise.resolve({ ...settings, model: 'New account model' });
  const refreshing = h.session.refresh(); h.session.configure({ userId: uuid(11), knowledgeBaseId: uuid(12), pageId: uuid(13) }, true);
  expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().settings).toBeNull(); expect(ask.signal.aborted).toBe(true);
  oldSettings.resolve({ ...settings, model: 'OLD PRIVATE MODEL' }); ask.emit({ type: 'delta', text: 'OLD SECRET' }); await pending; await refreshing; await flush();
  expect(h.session.getSnapshot().settings?.model).toBe('New account model'); expect(h.session.getSnapshot().conversation).toBeNull();
});

test('permission loss during a stream clears private state and its durable browser pointer', async () => {
  const h = harness(); await h.open(); h.data.set(uuid(4), conversation());
  const pending = h.session.send('Private question', 'document'), ask = h.asks[0]; start(ask); ask.emit({ type: 'delta', text: 'Sensitive partial' });
  expect(readConversationPointer(h.storage, scope.userId, scope.knowledgeBaseId)).toBe(uuid(4));
  ask.pending.reject(new AssistantRequestError('access_changed')); await pending;
  const result = h.session.getSnapshot(); expect(result.conversation).toBeNull(); expect(result.conversations).toEqual([]); expect(result.settings).toBeNull(); expect(result.ready).toBe(false); expect(result.errorCode).toBe('access_changed');
  expect(readConversationPointer(h.storage, scope.userId, scope.knowledgeBaseId)).toBeNull();
  ask.emit({ type: 'delta', text: 'Must stay hidden' }); expect(h.session.getSnapshot().conversation).toBeNull();
});

test('restored running conversations remain busy, can be stopped, and preserve server partial text', async () => {
  const h = harness(); saveConversationPointer(h.storage, { ...scope, conversationId: uuid(4) });
  h.data.set(uuid(4), conversation(uuid(4), [turn('running', 'Durable partial')]));
  await h.open(); expect(h.session.getSnapshot().busy).toBe(true); expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Durable partial');
  h.behavior.cancel = async (_base, id) => { h.data.set(id, conversation(id, [turn('cancelled', 'Durable partial', { errorCode: 'cancelled' })])); return new Response(null, { status: 204 }); };
  await h.session.stop(); expect(h.cancels).toEqual([uuid(4)]); expect(h.session.getSnapshot().busy).toBe(false); expect(h.session.getSnapshot().conversation?.turns[0]).toMatchObject({ answer: 'Durable partial', status: 'cancelled' });
});

test('restored running state polls until the server reaches a terminal turn', async () => {
  const h = harness(); saveConversationPointer(h.storage, { ...scope, conversationId: uuid(4) });
  h.data.set(uuid(4), conversation(uuid(4), [turn('running', 'Checkpoint')])); await h.open();
  h.data.set(uuid(4), conversation(uuid(4), [turn('done', 'Finished elsewhere')]));
  await new Promise(done => setTimeout(done, 1050));
  expect(h.gets).toHaveLength(2); expect(h.session.getSnapshot().busy).toBe(false); expect(h.session.getSnapshot().conversation?.turns[0].answer).toBe('Finished elsewhere');
});

test('restoration does not expose cached content before fresh access and denies redacted historical turns', async () => {
  const h = harness(); saveConversationPointer(h.storage, { ...scope, conversationId: uuid(4) });
  const read = deferred<AssistantConversation>(); h.behavior.get = () => read.promise; await h.open();
  expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().loading).toBe(true);
  read.resolve(conversation(uuid(4), [turn('unavailable', '', { question: '', errorCode: 'access_changed' })])); await flush();
  expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().errorCode).toBe('access_changed'); expect(h.session.getSnapshot().conversations).toEqual([]);
});

test('deleting an old conversation cannot clear a newer conversation selected while deletion is pending', async () => {
  const h = harness(); h.data.set(uuid(4), conversation()); h.data.set(uuid(14), conversation(uuid(14), [turn('done', 'New selection')])); await h.open(); await h.session.selectConversation(uuid(4));
  const removing = deferred<Response>(); h.behavior.remove = () => removing.promise;
  const deleting = h.session.removeConversation(uuid(4)); await flush(); await h.session.selectConversation(uuid(14));
  removing.resolve(new Response(null, { status: 204 })); await deleting;
  expect(h.session.getSnapshot().conversation?.id).toBe(uuid(14)); expect(readConversationPointer(h.storage, scope.userId, scope.knowledgeBaseId)).toBe(uuid(14));
});

test('deletion rejects active turns and reports one shared failed request without fake success', async () => {
  const h = harness(); await h.open(); const sending = h.session.send('Generating', 'document'), request = h.asks[0]; start(request);
  await expect(h.session.removeConversation(uuid(4))).rejects.toThrow('conversation_busy'); expect(h.removals).toHaveLength(0);
  finish(request); await sending;
  const removing = deferred<Response>(); h.behavior.remove = () => removing.promise;
  const first = h.session.removeConversation(uuid(4)), second = h.session.removeConversation(uuid(4));
  const results = Promise.allSettled([first, second]); await flush(); expect(h.removals).toEqual([uuid(4)]);
  removing.reject(new AssistantRequestError('FORBIDDEN'));
  expect((await results).map(result => result.status)).toEqual(['rejected', 'rejected']);
  expect(h.session.getSnapshot().conversation).toBeNull(); expect(h.session.getSnapshot().historyError).toBe('FORBIDDEN');
});

test('page changes cancel document generation, but not a knowledge-base generation captured without a page', async () => {
  const document = harness(); await document.open(); const first = document.session.send('Current document', 'document'); const ask = document.asks[0]; start(ask);
  document.session.configure({ ...scope, pageId: uuid(33) }, true); await first; await flush(); expect(ask.signal.aborted).toBe(true); expect(document.cancels).toEqual([uuid(4)]);
  const library = harness(); await library.open({ ...scope, pageId: null }); const second = library.session.send('Whole library', 'knowledgeBase'), request = library.asks[0]; start(request, uuid(4), turn('running', '', { pageId: null, mode: 'knowledgeBase' }));
  library.session.configure({ ...scope, pageId: uuid(33) }, true); expect(request.signal.aborted).toBe(false); expect(request.input.pageId).toBeNull();
  finish(request, turn('done', 'Library answer', { pageId: null, mode: 'knowledgeBase' })); await second;
});

test('retry captures the original turn page and mode instead of the newly active document', async () => {
  const h = harness(); const original = turn('failed', 'Partial', { errorCode: 'interrupted' }); h.data.set(uuid(4), conversation(uuid(4), [original])); await h.open(); await h.session.selectConversation(uuid(4));
  h.session.configure({ ...scope, pageId: uuid(33) }, true); const retry = h.session.retry(original); const request = h.asks[0];
  expect(request.input.pageId).toBe(scope.pageId); expect(request.input.question).toBe(original.question); start(request, uuid(4), turn('running', '', { id: uuid(6) })); finish(request, turn('done', 'Retried', { id: uuid(6) })); await retry;
});

test('unmount aborts pending work and a strict-mode remount can initialize a fresh session', async () => {
  const h = harness(); await h.open(); const pending = h.session.send('Pending', 'document'), request = h.asks[0]; h.session.dispose(); await pending;
  expect(request.signal.aborted).toBe(true); request.emit({ type: 'start', conversationId: uuid(4), turn: turn() }); expect(h.session.getSnapshot().conversation).toBeNull();
  await h.open(); expect(h.session.getSnapshot().ready).toBe(true); expect(h.settingCalls).toHaveLength(2);
});

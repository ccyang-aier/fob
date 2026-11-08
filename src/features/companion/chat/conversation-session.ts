import type { AssistantStreamEvent, AssistantTurn } from '@fob/shared/knowledge/contracts';
import { assistantApi, AssistantRequestError } from '@/features/knowledge/ai/assistant-api';
import { clearConversationPointer, readConversationPointer, saveConversationPointer } from './conversation-pointer';
import type { CompanionChatController, CompanionChatMode, CompanionChatScope } from './types';

type ConversationApi = typeof assistantApi;
type StoragePort = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type CompanionConversationSnapshot = Omit<CompanionChatController, 'send' | 'retry' | 'stop' | 'newConversation' | 'selectConversation' | 'removeConversation' | 'refresh' | 'clearError'> & { key: string | null };
type RunningRequest = { abort: AbortController; epoch: number; mode: CompanionChatMode; pageId: string | null; conversationId: string | null; turnId: string | null; accepted: boolean; finished: boolean };
const accessCodes = new Set(['access_changed', 'TARGET_NOT_ACCESSIBLE', 'FORBIDDEN', 'UNAUTHENTICATED', 'INSUFFICIENT_SCOPE']);
const codeOf = (error: unknown) => error instanceof AssistantRequestError ? error.code : 'interrupted';
const scopeKey = (scope: CompanionChatScope | null) => scope ? `${scope.userId}:${scope.knowledgeBaseId}` : null;
export const emptyCompanionConversation: CompanionConversationSnapshot = { key: null, conversation: null, conversations: [], settings: null, loading: false, historyLoading: false, settingsLoading: false, busy: false, ready: false, truncated: false, errorCode: null, historyError: null };

/** Owns one private user/library scope. It is independent of React providers. */
export class CompanionConversationSession {
  private state: CompanionConversationSnapshot = emptyCompanionConversation;
  private listeners = new Set<() => void>();
  private scope: CompanionChatScope | null = null;
  private enabled = false;
  private epoch = 0;
  private disposed = false;
  private selectedId: string | null = null;
  private requests = new Set<AbortController>();
  private threadAbort: AbortController | null = null;
  private threadSequence = 0;
  private listSequence = 0;
  private settingsSequence = 0;
  private run: RunningRequest | null = null;
  private cancelling = new Set<string>();
  private removing = new Map<string, Promise<void>>();
  private poll: ReturnType<typeof setTimeout> | null = null;
  private refreshTask: { epoch: number; promise: Promise<void> } | null = null;

  constructor(private readonly api: ConversationApi = assistantApi, private readonly storage?: StoragePort) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private valid(epoch: number) { return !this.disposed && epoch === this.epoch && this.scope !== null; }
  private patch(patch: Partial<CompanionConversationSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.state.busy = Boolean(this.run || this.selectedId && this.cancelling.has(this.selectedId) || this.state.conversation?.turns.at(-1)?.status === 'running');
    this.state.ready = this.state.settings?.ready === true;
    for (const listener of this.listeners) listener();
  }
  private stopPoll() { if (this.poll) clearTimeout(this.poll); this.poll = null; }
  private track() { const abort = new AbortController(); this.requests.add(abort); return abort; }
  private release(abort: AbortController) { this.requests.delete(abort); }
  private clearPointer(id?: string) { if (this.scope) clearConversationPointer(this.storage, this.scope.userId, this.scope.knowledgeBaseId, id); }
  private remember(id: string) { if (this.scope) saveConversationPointer(this.storage, { userId: this.scope.userId, knowledgeBaseId: this.scope.knowledgeBaseId, conversationId: id }); }

  configure(scope: CompanionChatScope | null, enabled: boolean) {
    this.disposed = false;
    const key = scopeKey(scope), changed = key !== scopeKey(this.scope), opened = enabled && !this.enabled;
    const oldPage = this.scope?.pageId;
    if (changed) {
      this.epoch++;
      for (const abort of this.requests) abort.abort();
      this.requests.clear(); this.stopPoll(); this.run = null; this.threadAbort = null; this.cancelling.clear(); this.removing.clear(); this.refreshTask = null;
      this.scope = scope;
      this.selectedId = scope ? readConversationPointer(this.storage, scope.userId, scope.knowledgeBaseId) : null;
      this.state = { ...emptyCompanionConversation, key };
      this.patch({});
    } else this.scope = scope;
    this.enabled = enabled;
    if (!scope) return;
    if (!changed && oldPage !== scope.pageId && this.run?.mode === 'document') void this.stop();
    if (enabled && (changed || opened)) {
      // Persisted and completed history must pass a fresh authorization check on re-open.
      this.patch({ conversations: [], settings: null, historyLoading: true, settingsLoading: true });
      if (!this.run && !this.cancelling.size) this.patch({ conversation: null, loading: Boolean(this.selectedId) });
      void this.refresh();
    } else this.schedulePoll();
  }

  dispose() {
    this.disposed = true; this.epoch++; this.stopPoll();
    for (const abort of this.requests) abort.abort();
    this.requests.clear(); this.run = null; this.threadAbort = null; this.refreshTask = null;
    this.scope = null; this.enabled = false; this.selectedId = null; this.state = emptyCompanionConversation;
  }

  private deny(code: string) {
    this.clearPointer(); this.epoch++;
    for (const abort of this.requests) abort.abort();
    this.requests.clear(); this.stopPoll(); this.run = null; this.selectedId = null; this.cancelling.clear(); this.refreshTask = null;
    this.patch({ conversation: null, conversations: [], settings: null, loading: false, historyLoading: false, settingsLoading: false, errorCode: code, historyError: code, truncated: false });
  }
  private handle(error: unknown, epoch: number, history = false) {
    if (!this.valid(epoch)) return;
    const code = codeOf(error);
    if (accessCodes.has(code)) this.deny(code);
    else this.patch(history ? { historyError: code } : { errorCode: code });
  }

  private async loadSettings() {
    if (!this.scope) return;
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, sequence = ++this.settingsSequence, abort = this.track();
    this.patch({ settingsLoading: true });
    try {
      const settings = await this.api.settings(base, abort.signal);
      if (this.valid(epoch) && !abort.signal.aborted && sequence === this.settingsSequence) this.patch({ settings, settingsLoading: false });
    } catch (error) { if (!abort.signal.aborted && sequence === this.settingsSequence) this.handle(error, epoch); }
    finally { this.release(abort); if (this.valid(epoch) && sequence === this.settingsSequence) this.patch({ settingsLoading: false }); }
  }
  private async loadHistory() {
    if (!this.scope) return;
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, sequence = ++this.listSequence, abort = this.track();
    this.patch({ historyLoading: true, historyError: null });
    try {
      const conversations = await this.api.list(base, abort.signal);
      if (this.valid(epoch) && !abort.signal.aborted && sequence === this.listSequence) this.patch({ conversations });
    } catch (error) { if (!abort.signal.aborted && sequence === this.listSequence) this.handle(error, epoch, true); }
    finally { this.release(abort); if (this.valid(epoch) && sequence === this.listSequence) this.patch({ historyLoading: false }); }
  }
  private async loadConversation(hide = false) {
    if (!this.scope || !this.selectedId) return;
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, id = this.selectedId, sequence = ++this.threadSequence;
    this.threadAbort?.abort();
    const abort = this.track(); this.threadAbort = abort;
    if (hide) this.patch({ conversation: null, loading: true });
    const current = () => this.valid(epoch) && !abort.signal.aborted && sequence === this.threadSequence && this.selectedId === id;
    try {
      const conversation = await this.api.get(base, id, abort.signal);
      if (!current()) return;
      if (conversation.turns.some(turn => turn.status === 'unavailable')) {
        // The server has removed an inaccessible source; no stale private answer may survive.
        this.deny('access_changed'); return;
      }
      // A durable checkpoint can lag behind a locally streaming answer. The GET
      // still rechecks authorization, but it must not roll its text backwards.
      if (!this.run || this.run.conversationId !== id) this.patch({ conversation });
    } catch (error) {
      if (!current()) return;
      const code = codeOf(error);
      if (code === 'conversation_not_found' || code === 'NOT_FOUND') {
        this.clearPointer(id); this.selectedId = null; this.patch({ conversation: null, loading: false, truncated: false });
      } else this.handle(error, epoch);
    } finally {
      this.release(abort); if (this.threadAbort === abort) this.threadAbort = null;
      if (current()) { this.patch({ loading: false }); this.schedulePoll(); }
    }
  }
  private schedulePoll() {
    this.stopPoll();
    if (this.disposed || !this.scope || !this.selectedId || this.run || !this.enabled && !this.state.busy) return;
    const delay = this.state.conversation?.turns.at(-1)?.status === 'running' ? 1_000 : 15_000;
    this.poll = setTimeout(() => { this.poll = null; void this.loadConversation(); }, delay);
  }

  refresh = async () => {
    if (!this.scope || this.disposed) return;
    if (this.refreshTask?.epoch === this.epoch) return this.refreshTask.promise;
    const epoch = this.epoch;
    this.patch({ errorCode: null, historyError: null });
    const promise = Promise.all([this.loadSettings(), this.loadHistory(), this.loadConversation()]).then(() => {});
    this.refreshTask = { epoch, promise };
    try { await promise; } finally { if (this.refreshTask?.promise === promise) this.refreshTask = null; }
  };
  clearError = () => this.patch({ errorCode: null });
  newConversation = () => {
    if (this.state.busy) { this.patch({ errorCode: 'conversation_busy' }); return; }
    this.threadSequence++; this.threadAbort?.abort(); this.stopPoll(); this.clearPointer(); this.selectedId = null;
    this.patch({ conversation: null, loading: false, truncated: false, errorCode: null });
  };
  selectConversation = async (id: string) => {
    if (!this.scope || this.disposed) return;
    if (this.state.busy) throw new AssistantRequestError('conversation_busy');
    this.selectedId = id; this.remember(id); this.patch({ errorCode: null, truncated: false });
    await this.loadConversation(true);
  };
  removeConversation = async (id: string) => {
    if (!this.scope || this.disposed) return;
    if (this.selectedId === id && this.state.busy) throw new AssistantRequestError('conversation_busy');
    const existing = this.removing.get(id); if (existing) return existing;
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, abort = this.track();
    const promise = Promise.resolve().then(async () => {
      try {
        await this.api.remove(base, id, abort.signal);
        if (!this.valid(epoch) || abort.signal.aborted) return;
        this.clearPointer(id);
        if (this.selectedId === id) { this.selectedId = null; this.threadSequence++; this.threadAbort?.abort(); this.patch({ conversation: null, loading: false, truncated: false }); }
        this.patch({ conversations: this.state.conversations.filter(item => item.id !== id) });
        await this.loadHistory();
      } catch (error) { if (!abort.signal.aborted && this.valid(epoch)) { this.handle(error, epoch, true); throw error; } }
      finally { this.release(abort); if (this.removing.get(id) === promise) this.removing.delete(id); }
    });
    this.removing.set(id, promise); return promise;
  };

  send = (question: string, mode: CompanionChatMode, onStarted?: () => void) => this.ask(question, mode, this.scope?.pageId ?? null, onStarted);
  retry = async (turn: AssistantTurn) => {
    const original = this.state.conversation?.turns.find(item => item.id === turn.id);
    if (!original || original.status === 'unavailable' || original.status === 'running') return;
    await this.ask(original.question, original.mode, original.pageId);
  };

  private async ask(question: string, mode: CompanionChatMode, pageId: string | null, onStarted?: () => void) {
    if (!this.scope || this.disposed || this.run || this.state.busy || this.state.loading || !question.trim()) return;
    if (!this.state.ready) { this.patch({ errorCode: 'configuration' }); return; }
    if (mode === 'document' && !pageId) { this.patch({ errorCode: 'invalid_request' }); return; }
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, abort = this.track();
    const run: RunningRequest = { abort, epoch, mode, pageId, conversationId: this.selectedId, turnId: null, accepted: false, finished: false };
    this.run = run; this.stopPoll(); this.threadSequence++; this.threadAbort?.abort();
    let result = this.state.conversation;
    this.patch({ errorCode: null, truncated: false });
    const current = () => this.valid(epoch) && this.run === run && !abort.signal.aborted;
    try {
      await this.api.ask(base, { pageId, ...(this.selectedId ? { conversationId: this.selectedId } : {}), requestId: crypto.randomUUID(), question: question.trim(), mode, tier: 'fast' }, abort.signal, (event: AssistantStreamEvent) => {
        if (!current()) return;
        if (event.type === 'start') {
          if (run.accepted) {
            if (run.conversationId !== event.conversationId || run.turnId !== event.turn.id) throw new AssistantRequestError('invalid_response');
            return;
          }
          run.accepted = true; run.conversationId = event.conversationId; run.turnId = event.turn.id;
          this.selectedId = event.conversationId; this.remember(event.conversationId);
          result = { id: event.conversationId, title: result?.title || question.trim().slice(0, 60), updatedAt: event.turn.createdAt, turns: [...(result?.turns ?? []).filter(turn => turn.id !== event.turn.id), event.turn].slice(-20) };
          this.patch({ conversation: result }); onStarted?.(); return;
        }
        if (!result || !run.turnId) return;
        const last = result.turns.at(-1)!;
        if (event.type === 'sources') { this.patch({ truncated: event.truncated }); result = { ...result, turns: [...result.turns.slice(0, -1), { ...last, sources: event.sources }] }; }
        if (event.type === 'delta') result = { ...result, turns: [...result.turns.slice(0, -1), { ...last, answer: (last.answer + event.text).slice(0, 64000) }] };
        if (event.type === 'tool') result = { ...result, turns: [...result.turns.slice(0, -1), { ...last, toolSteps: [...(last.toolSteps ?? []).filter(step => step.id !== event.step.id), event.step].slice(-40) }] };
        if (event.type === 'finish') {
          if (accessCodes.has(event.turn.errorCode ?? '') || event.turn.status === 'unavailable') { this.deny(event.turn.errorCode ?? 'access_changed'); return; }
          run.finished = true;
          result = { ...result, turns: [...result.turns.slice(0, -1), event.turn] };
          if (event.turn.status === 'failed') this.patch({ errorCode: event.turn.errorCode ?? 'failed' });
        }
        this.patch({ conversation: result });
      });
      if (current() && !run.finished) throw new AssistantRequestError('interrupted');
    } catch (error) {
      if (!current()) return;
      const code = codeOf(error);
      if (accessCodes.has(code)) { this.deny(code); return; }
      if (result?.turns.at(-1)?.status === 'running') {
        const last = result.turns.at(-1)!;
        result = { ...result, turns: [...result.turns.slice(0, -1), { ...last, status: 'failed', errorCode: code }] };
      }
      this.patch({ conversation: result, errorCode: code });
    } finally {
      this.release(abort);
      if (this.run === run && this.valid(epoch)) {
        this.run = null; this.patch({}); this.schedulePoll(); void this.loadHistory();
      }
    }
  }

  stop = async () => {
    if (!this.scope || this.disposed) return;
    const run = this.run, target = run?.conversationId ?? this.selectedId;
    if (!run && !this.state.busy) return;
    if (run) {
      this.run = null; run.abort.abort(); this.release(run.abort);
      const last = this.state.conversation?.turns.at(-1);
      if (last?.status === 'running') this.patch({ conversation: { ...this.state.conversation!, turns: [...this.state.conversation!.turns.slice(0, -1), { ...last, status: 'cancelled', errorCode: 'cancelled' }] } });
    }
    if (!target) { this.patch({}); return; }
    if (this.cancelling.has(target)) return;
    const epoch = this.epoch, base = this.scope.knowledgeBaseId, abort = this.track();
    this.cancelling.add(target); this.patch({});
    try { await this.api.cancel(base, target, abort.signal); if (this.valid(epoch) && !abort.signal.aborted && this.selectedId === target) await this.loadConversation(); }
    catch (error) { if (!abort.signal.aborted) this.handle(error, epoch); }
    finally { this.release(abort); this.cancelling.delete(target); if (this.valid(epoch)) { this.patch({}); this.schedulePoll(); } }
  };
}

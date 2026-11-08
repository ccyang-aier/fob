import type { Pool } from 'pg';
import type { Hocuspocus } from '@hocuspocus/server';
import { assistantAskSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantStreamEvent, AssistantTurn } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../../access';
import { KnowledgeAccessError, requireKnowledgeScopes } from '../../access';
import type { ModelGateway } from '../gateway';
import { ModelGatewayError } from '../gateway';
import { insertSuggestedMarkdown } from '../tools/write';
import { KnowledgeAgentToolError } from '../tools/errors';
import { AssistantError, createAssistantConversations } from './conversations';
import { assembleAssistantContext, assembleAssistantHistory } from './context';
import type { AssistantPreferences } from './preferences';
import { eq, sql } from 'drizzle-orm';
import { knowledgeBase } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { createGatewayAgentModel, createKnowledgeAgentTools, knowledgeAgentSystem, runKnowledgeAgent } from '../agent';
import type { KnowledgeAgentSearchModels } from '../tools/types';

const codeOf = (error: unknown) => error instanceof ModelGatewayError || error instanceof AssistantError ? error.code : 'provider_unavailable';
export function createAssistantService(deps: { pool: Pool; gateway: ModelGateway; preferences: AssistantPreferences; hocuspocus?: Hocuspocus; search?: KnowledgeAgentSearchModels }) {
  const conversations = createAssistantConversations(deps.pool);
  const active = new Map<string, { userId: string; knowledgeBaseId: string; controller: AbortController }>();
  async function ask(actor: KnowledgeRequestContext, raw: unknown, options: { signal: AbortSignal; refresh: () => Promise<KnowledgeRequestContext>; emit: (event: AssistantStreamEvent) => Promise<void> }) {
    const input = assistantAskSchema.parse(raw);
    options.signal.throwIfAborted();
    requireKnowledgeScopes(actor, ['read']);
    // Read authorization and actual configuration both precede creation/model work.
    const context = await assembleAssistantContext(deps.pool, actor, input);
    options.signal.throwIfAborted();
    const availableSettings = await deps.preferences.resolveFor(actor, input.selection);
    const available = await deps.preferences.read(actor);
    if (!availableSettings[input.tier] && !available.platformModels?.[input.tier] && !(!available.platformModels && available.ready)) throw new AssistantError('configuration', 503);
    if ([...active.values()].filter(task => task.userId === actor.userId).length >= 2) throw new AssistantError('too_many_requests', 429);
    const started = await conversations.begin(actor, input);
    const turn: AssistantTurn = started.replay ? (await conversations.get(actor, started.id)).turns.find(item => item.id === started.turn.id)! : { ...started.turn, sources: context.sources, contextPageIds: context.contextPageIds, toolSteps: [] };
    if (started.replay) { await options.emit({ type: 'start', conversationId: started.id, turn }); await options.emit({ type: 'finish', turn }); return; }
    const controller = new AbortController();
    active.set(started.id, { userId: actor.userId, knowledgeBaseId: actor.knowledgeBaseId, controller });
    const signal = AbortSignal.any([controller.signal, options.signal]);
    let lastCheck = 0;
    let authority = actor;
    const syncLedger = () => { turn.sources = context.ledger.sources; turn.contextPageIds = context.ledger.contextPageIds; };
    const recheck = async (force = false) => {
      signal.throwIfAborted();
      if (!force && Date.now() - lastCheck < 750) return;
      if (await conversations.cancellationRequested(actor, started.id, turn.id)) { controller.abort(); signal.throwIfAborted(); }
      const fresh = await options.refresh();
      if (fresh.userId !== actor.userId || fresh.knowledgeBaseId !== actor.knowledgeBaseId) throw new AssistantError('access_changed', 403);
      requireKnowledgeScopes(fresh, ['read']);
      authority = fresh;
      syncLedger();
      if (!await conversations.visible(authority, turn)) throw new AssistantError('access_changed', 403);
      signal.throwIfAborted();
      lastCheck = Date.now();
    };
    // Serialize heartbeats and wait for the last one before saving terminal state.
    // A slow model still refreshes authorization and keeps the database lease alive.
    let checkpoint = Promise.resolve();
    const heartbeat = setInterval(() => {
      checkpoint = checkpoint.then(async () => {
        if (turn.status !== 'running') return;
        await recheck(true);
        if (turn.status === 'running') await conversations.save(authority, started.id, { ...turn, sources: [...turn.sources], contextPageIds: [...turn.contextPageIds ?? []], toolSteps: [...turn.toolSteps ?? []] });
      }).catch(error => { controller.abort(error); });
    }, 15_000);
    heartbeat.unref?.();
    let polling = false;
    const cancelPoll = setInterval(() => {
      if (polling || turn.status !== 'running' || signal.aborted) return;
      polling = true;
      void conversations.cancellationRequested(actor, started.id, turn.id).then(requested => {
        if (requested) controller.abort();
      }).catch(error => { controller.abort(error); }).finally(() => { polling = false; });
    }, 1_500);
    cancelPoll.unref?.();
    try {
      await recheck(true);
      await options.emit({ type: 'start', conversationId: started.id, turn });
      await options.emit({ type: 'sources', sources: context.sources, truncated: context.truncated });
      await conversations.save(authority, started.id, turn);
      const history = (await conversations.get(actor, started.id)).turns.filter(item => item.id !== turn.id && item.status === 'done').slice(-6);
      const preparedHistory = await assembleAssistantHistory(context.ledger, history, input, signal);
      syncLedger();
      if (turn.sources.length !== context.sources.length || context.ledger.truncated !== context.truncated) await options.emit({ type: 'sources', sources: turn.sources, truncated: context.ledger.truncated });
      const tools = createKnowledgeAgentTools({ pool: deps.pool, authority: () => authority, mode: input.mode, pageId: input.pageId, ledger: context.ledger, search: deps.search });
      const model = createGatewayAgentModel({ gateway: deps.gateway, tier: input.tier,
        context: { knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, taskId: started.id }, resolveSettings: () => deps.preferences.resolveFor(authority, input.selection) });
      let publishedSources = turn.sources.length, publishedTruncated = context.truncated;
      await runKnowledgeAgent({ model, tools, signal, check: recheck,
        ...(input.tier === 'fast' ? { limits: { modelSteps: 6, toolCalls: 12, timeoutMs: 120_000 } } : {}),
        system: knowledgeAgentSystem({ mode: input.mode, title: context.title, context: [context.text, preparedHistory.text].filter(Boolean).join('\n\n') }),
        messages: [...preparedHistory.messages, { role: 'user', content: input.question }],
        onText: async text => { turn.answer += text; await options.emit({ type: 'delta', text }); },
        onUsage: (name, usage) => { turn.model = name; turn.inputTokens = usage.inputTokens; turn.outputTokens = usage.outputTokens; },
        onTool: async step => {
          await recheck(true);
          const index = turn.toolSteps!.findIndex(item => item.id === step.id);
          if (index < 0) turn.toolSteps!.push(step); else turn.toolSteps![index] = step;
          if (turn.sources.length !== publishedSources || context.ledger.truncated !== publishedTruncated) {
            publishedSources = turn.sources.length; publishedTruncated = context.ledger.truncated;
            await options.emit({ type: 'sources', sources: turn.sources, truncated: publishedTruncated });
          }
          await options.emit({ type: 'tool', step });
        },
      });
      if (!turn.answer.trim()) throw new ModelGatewayError('invalid_response');
      // A model cannot manufacture a clickable citation to an undisclosed source.
      turn.answer = turn.answer.replace(/\[([^\]]+)\]\(fob-source:(\d+)\)/g, (all, label: string, id: string) => turn.sources.some(source => source.id === Number(id)) ? all : /^\d+$/.test(label) ? '' : label);
      await recheck(true);
      turn.status = 'done';
    } catch (error) {
      turn.status = signal.aborted ? 'cancelled' : 'failed';
      turn.errorCode = signal.aborted ? 'cancelled' : codeOf(error);
      const failure = signal.aborted && signal.reason instanceof Error ? signal.reason : error;
      const authorityLost = failure instanceof KnowledgeAccessError || failure instanceof AssistantError && failure.code === 'access_changed';
      if (authorityLost || !await conversations.visible(actor, turn).catch(() => false)) {
        turn.question = ''; turn.answer = ''; turn.sources = []; turn.toolSteps = []; turn.contextPageIds = []; turn.status = 'unavailable'; turn.errorCode = 'access_changed';
      }
      turn.toolSteps = turn.toolSteps?.map(step => step.status === 'running' ? { ...step, status: 'failed', summary: '已停止读取' } : step);
    } finally {
      clearInterval(heartbeat);
      clearInterval(cancelPoll);
      await checkpoint;
      try { await conversations.save(actor, started.id, turn); }
      finally { active.delete(started.id); }
    }
    if (!options.signal.aborted) await options.emit({ type: 'finish', turn });
  }
  async function apply(actor: KnowledgeRequestContext, conversationId: string, turnId: string, pageId: string) {
    const conversation = await conversations.get(actor, conversationId), turn = conversation.turns.find(item => item.id === turnId);
    if (!turn?.answer || turn.status !== 'done') throw new AssistantError('answer_unavailable', 409);
    if (turn.appliedPageId) return { applied: turn.appliedPageId === pageId, pageId: turn.appliedPageId };
    // One permission fence covers the shared-body write and its completion marker.
    return withKnowledgeBase(deps.pool, actor.knowledgeBaseId, async db => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:apply:${actor.knowledgeBaseId}:${actor.userId}:${turn.id}`},0))`);
      // KEY SHARE blocks the ACL writer's FOR UPDATE while allowing the
      // collaboration store's foreign-key checks on its separate connection.
      const [base] = await db.select({ id: knowledgeBase.id }).from(knowledgeBase).where(eq(knowledgeBase.id, actor.knowledgeBaseId)).for('key share');
      if (!base) throw new AssistantError('access_changed', 403);
      const latest = (await conversations.get(actor, conversationId)).turns.find(item => item.id === turnId);
      if (!latest?.answer || latest.status !== 'done') throw new AssistantError('answer_unavailable', 409);
      if (latest.appliedPageId) return { applied: latest.appliedPageId === pageId, pageId: latest.appliedPageId };
      const markdown = latest.answer.replace(/\[([^\]]+)\]\(fob-source:(\d+)\)/g, (_all, label: string, id: string) => {
        const source = latest.sources.find(source => source.id === Number(id));
        return source ? `[${label}](/?view=knowledge&knowledgeBase=${actor.knowledgeBaseId}&document=${source.pageId}&source=server&block=${source.blockId})` : label;
      });
      try {
        await insertSuggestedMarkdown({ knowledgeBaseId: actor.knowledgeBaseId, pageId, markdown,
          receipt: { userId: actor.userId, turnId: turn.id, retainedTurnIds: await conversations.pendingApplyTurnIds(actor) } },
        { pool: deps.pool, authority: actor, agent: { taskId: turn.id }, hocuspocus: deps.hocuspocus });
      } catch (error) {
        if (error instanceof KnowledgeAgentToolError && error.code === 'TARGET_NOT_ACCESSIBLE') throw new AssistantError('access_changed', 403);
        throw error;
      }
      await conversations.save(actor, conversationId, { ...latest, appliedPageId: pageId });
      return { applied: true, pageId };
    });
  }
  return { conversations, ask, apply, preferences: deps.preferences,
    async checkConnection(actor: KnowledgeRequestContext, connectionId: string, modelId: string, signal: AbortSignal) {
      const started = performance.now();
      const result = await deps.gateway.generate({ context: { knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId }, settings: await deps.preferences.resolveFor(actor, { connectionId, modelId }), tier: 'fast', messages: [{ role: 'user', content: 'Reply OK.' }], maxOutputTokens: 256, maxRetries: 0, timeoutMs: 45000, signal });
      return { model: result.model.model, latencyMs: Math.max(0, Math.round(performance.now() - started)) };
    },
    async cancel(actor: KnowledgeRequestContext, id: string) { const task = active.get(id); if (task?.userId === actor.userId && task.knowledgeBaseId === actor.knowledgeBaseId) task.controller.abort(); await conversations.requestCancel(actor, id); },
    async check(actor: KnowledgeRequestContext, signal: AbortSignal) { const result = await deps.gateway.generate({ context: { knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId }, settings: await deps.preferences.resolve(actor), tier: 'fast', messages: [{ role: 'user', content: 'Reply OK.' }], maxOutputTokens: 256, maxRetries: 0, timeoutMs: 45000, signal }); return { model: result.model.model }; },
  };
}
export type AssistantService = ReturnType<typeof createAssistantService>;

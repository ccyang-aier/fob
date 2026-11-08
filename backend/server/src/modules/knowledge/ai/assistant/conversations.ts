import { randomUUID } from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { assistantTurnSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantAsk, AssistantConversation, AssistantTurn } from '@fob/shared/knowledge/contracts';
import { aiTask, aiUsage } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../../permissions';
import type { KnowledgeRequestContext } from '../../access';
import { validateCitations } from '../context';

export class AssistantError extends Error {
  constructor(readonly code: string, readonly status: 400 | 403 | 404 | 409 | 429 | 503 = 400) { super(code); }
}
export function createAssistantConversations(pool: Pool) {
  const own = (actor: KnowledgeRequestContext, id?: string) => and(eq(aiTask.knowledgeBaseId, actor.knowledgeBaseId), eq(aiTask.initiatedBy, actor.userId), eq(aiTask.kind, 'chat'), sql`${aiTask.state}->>'assistantVersion' = '1'`, id ? eq(aiTask.id, id) : undefined);
  async function visible(actor: KnowledgeRequestContext, turn: AssistantTurn) {
    const readable = await withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      const pageIds = [turn.pageId, ...(turn.contextPageIds ?? []), ...turn.sources.map(source => source.pageId)].filter((pageId): pageId is string => pageId !== null);
      for (const pageId of new Set(pageIds)) {
        if ((await authorizePageAccess(db, { userId: actor.userId, scope: { knowledgeBaseId: actor.knowledgeBaseId, pageId }, required: 'view' })).decision !== 'allow') return false;
      }
      return true;
    });
    return readable;
  }
  function turnsOf(state: Record<string, unknown>): AssistantTurn[] {
    return Array.isArray(state.turns) ? state.turns.map(turn => assistantTurnSchema.parse(turn)) : [];
  }
  async function get(actor: KnowledgeRequestContext, id: string): Promise<AssistantConversation> {
    const row = await withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      let current = (await db.select().from(aiTask).where(own(actor, id)))[0];
      if (current?.status === 'running' && Date.now() - current.updatedAt.getTime() >= 180_000) {
        await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
        current = (await db.select().from(aiTask).where(own(actor, id)))[0];
        if (current?.status === 'running' && Date.now() - current.updatedAt.getTime() >= 180_000) {
          const turns = turnsOf(current.state).map(turn => turn.status === 'running' ? { ...turn, status: 'cancelled' as const, errorCode: 'interrupted' } : turn);
          [current] = await db.update(aiTask).set({ status: 'failed', state: { assistantVersion: 1, turns }, updatedAt: new Date() }).where(own(actor, id)).returning();
        }
      }
      return current;
    });
    if (!row) throw new AssistantError('conversation_not_found', 404);
    const turns: AssistantTurn[] = [];
    for (const turn of turnsOf(row.state)) {
      const allowed = await visible(actor, turn);
      if (!allowed) {
        turns.push({ ...turn, question: '', answer: '', sources: [], toolSteps: [], contextPageIds: [], status: 'unavailable', errorCode: 'access_changed', model: null, inputTokens: null, outputTokens: null });
        continue;
      }
      // Editing or removing a block invalidates its anchor, not the authorized
      // conversation. Keep the answer and remove only stale clickable sources.
      const verdicts = await validateCitations(pool, { knowledgeBaseId: actor.knowledgeBaseId, userId: actor.userId, citedBlockIds: turn.sources });
      const sources = turn.sources.filter(source => verdicts.some(verdict => verdict.status === 'valid' && verdict.pageId === source.pageId && verdict.blockId === source.blockId));
      turns.push({ ...turn, sources, answer: turn.answer.replace(/\[([^\]]+)\]\(fob-source:(\d+)\)/g, (all, label: string, sourceId: string) => sources.some(source => source.id === Number(sourceId)) ? all : /^\d+$/.test(label) ? '' : label) });
    }
    return { id, title: turns.find(turn => turn.status !== 'unavailable')?.question.slice(0, 60) ?? '', turns, updatedAt: row.updatedAt.toISOString() };
  }
  async function begin(actor: KnowledgeRequestContext, input: AssistantAsk) {
    return withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
      const prior = input.conversationId ? undefined : (await db.select().from(aiTask).where(and(own(actor), sql`EXISTS (SELECT 1 FROM jsonb_array_elements(${aiTask.state}->'turns') AS turn WHERE turn->>'id' = ${input.requestId})`)).limit(1))[0];
      const id = input.conversationId ?? prior?.id ?? randomUUID();
      const row = prior ?? (await db.select().from(aiTask).where(own(actor, id)))[0];
      if (input.conversationId && !row) throw new AssistantError('conversation_not_found', 404);
      const turns = row ? turnsOf(row.state) : [];
      const existing = turns.find(turn => turn.id === input.requestId);
      if (existing) {
        if (existing.question !== input.question || existing.pageId !== input.pageId || existing.mode !== input.mode) throw new AssistantError('request_conflict', 409);
        if (existing.status === 'running') throw new AssistantError('conversation_busy', 409);
        return { id, turn: existing, replay: true };
      }
      const otherRuns = await db.select().from(aiTask).where(and(own(actor), eq(aiTask.status, 'running')));
      for (const abandoned of otherRuns.filter(row => Date.now() - row.updatedAt.getTime() >= 180_000)) {
        const abandonedTurns = turnsOf(abandoned.state).map(turn => turn.status === 'running' ? { ...turn, status: 'cancelled' as const, errorCode: 'interrupted' } : turn);
        await db.update(aiTask).set({ status: 'failed', state: { assistantVersion: 1, turns: abandonedTurns }, updatedAt: new Date() }).where(own(actor, abandoned.id));
      }
      if (otherRuns.filter(row => Date.now() - row.updatedAt.getTime() < 180_000).length >= 2) throw new AssistantError('too_many_requests', 429);
      const active = turns.at(-1);
      if (active?.status === 'running') {
        if (Date.now() - row!.updatedAt.getTime() < 180_000) throw new AssistantError('conversation_busy', 409);
        active.status = 'cancelled'; active.errorCode = 'interrupted';
      }
      const turn: AssistantTurn = { id: input.requestId, question: input.question, answer: '', pageId: input.pageId, mode: input.mode, status: 'running', sources: [], errorCode: null, createdAt: new Date().toISOString(), appliedPageId: null, model: null, inputTokens: null, outputTokens: null };
      turns.push(turn);
      const state = { assistantVersion: 1, turns: turns.slice(-20) };
      await db.insert(aiTask).values({ knowledgeBaseId: actor.knowledgeBaseId, id, initiatedBy: actor.userId, kind: 'chat', status: 'running', state }).onConflictDoUpdate({ target: [aiTask.knowledgeBaseId, aiTask.id], set: { status: 'running', state, updatedAt: new Date() } });
      const threads = await db.select({ id: aiTask.id, status: aiTask.status }).from(aiTask).where(own(actor)).orderBy(desc(aiTask.updatedAt), desc(aiTask.id));
      const finalThreads = threads.filter(thread => thread.status !== 'running');
      const keep = Math.max(0, 10 - threads.length + finalThreads.length);
      for (const old of finalThreads.slice(keep)) {
        await db.update(aiUsage).set({ taskId: null }).where(and(eq(aiUsage.knowledgeBaseId, actor.knowledgeBaseId), eq(aiUsage.taskId, old.id)));
        await db.delete(aiTask).where(own(actor, old.id));
      }
      return { id, turn, replay: false };
    });
  }
  async function save(actor: KnowledgeRequestContext, id: string, turn: AssistantTurn) {
    await withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
      const row = (await db.select().from(aiTask).where(own(actor, id)))[0];
      if (!row) throw new AssistantError('conversation_not_found', 404);
      const turns = turnsOf(row.state), index = turns.findIndex(item => item.id === turn.id);
      if (index < 0) throw new AssistantError('turn_not_found', 404);
      turns[index] = turn;
      await db.update(aiTask).set({ state: { ...row.state, assistantVersion: 1, turns }, status: turn.status === 'running' ? 'running' : turn.status === 'failed' ? 'failed' : 'done', updatedAt: new Date() }).where(own(actor, id));
    });
  }
  async function list(actor: KnowledgeRequestContext) {
    const rows = await withKnowledgeBase(pool, actor.knowledgeBaseId, db => db.select({ id: aiTask.id, state: aiTask.state, updatedAt: aiTask.updatedAt }).from(aiTask).where(own(actor)).orderBy(desc(aiTask.updatedAt), desc(aiTask.id)).limit(10));
    const result = [];
    for (const row of rows) {
      let title = '';
      for (const turn of turnsOf(row.state)) {
        if (turn.status === 'unavailable' || !turn.question || !await visible(actor, turn)) continue;
        title = turn.question.slice(0, 60);
        break;
      }
      result.push({ id: row.id, title, updatedAt: row.updatedAt.toISOString() });
    }
    return result;
  }
  async function remove(actor: KnowledgeRequestContext, id: string) {
    await withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      if (!(await db.select({ id: aiTask.id }).from(aiTask).where(own(actor, id))).length) return;
      await db.update(aiUsage).set({ taskId: null }).where(and(eq(aiUsage.knowledgeBaseId, actor.knowledgeBaseId), eq(aiUsage.userId, actor.userId), eq(aiUsage.taskId, id)));
      await db.delete(aiTask).where(own(actor, id));
    });
  }
  /** Durable cancellation survives routing to another API process. */
  async function requestCancel(actor: KnowledgeRequestContext, id: string) {
    return withKnowledgeBase(pool, actor.knowledgeBaseId, async db => {
      await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`fob:assistant:${actor.knowledgeBaseId}:${actor.userId}`},0))`);
      const row = (await db.select().from(aiTask).where(own(actor, id)))[0];
      const turn = row ? turnsOf(row.state).at(-1) : undefined;
      if (!row || turn?.status !== 'running') return false;
      await db.update(aiTask).set({ state: { ...row.state, cancelRequestedTurnId: turn.id }, updatedAt: new Date() }).where(own(actor, id));
      return true;
    });
  }
  async function cancellationRequested(actor: KnowledgeRequestContext, id: string, turnId: string) {
    const rows = await withKnowledgeBase(pool, actor.knowledgeBaseId, db => db.select({ requested: sql<boolean>`${aiTask.state}->>'cancelRequestedTurnId' = ${turnId}` }).from(aiTask).where(own(actor, id)));
    // Removing a conversation also stops its abandoned producer.
    return !rows.length || rows[0]!.requested === true;
  }
  async function pendingApplyTurnIds(actor: KnowledgeRequestContext) {
    const rows = await withKnowledgeBase(pool, actor.knowledgeBaseId, db => db.select({ state: aiTask.state }).from(aiTask).where(own(actor)));
    return rows.flatMap(row => turnsOf(row.state).filter(turn => turn.status === 'done' && !turn.appliedPageId).map(turn => turn.id)).slice(-200);
  }
  return { get, begin, save, list, remove, visible, requestCancel, cancellationRequested, pendingApplyTurnIds };
}
export type AssistantConversations = ReturnType<typeof createAssistantConversations>;

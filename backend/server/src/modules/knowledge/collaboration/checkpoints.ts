import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Extension, Hocuspocus } from '@hocuspocus/server';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import type { Actor, PageScope } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { docCheckpoint, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { PageCollaborationContext } from './page-collaboration';
import { pageDocumentName, parsePageDocument } from '@fob/shared/knowledge/collaboration';
import { PAGE_BODY_FRAGMENT, insertProseMirrorBlocks, yStateToProseMirrorDoc } from '../import-export/y-encoding';

/** §5.2: an automatic checkpoint fires once this much time passed since the previous one. */
export const CHECKPOINT_INTERVAL_MS = 10 * 60 * 1_000;

/** Matches the doc_checkpoint.label varchar bound. */
export const CHECKPOINT_LABEL_MAX_LENGTH = 200;

export interface PageCheckpointPolicy {
  /** Threshold since the previous checkpoint; production default is 10 minutes. */
  intervalMs?: number;
  /** Injectable clock so interval decisions are testable. */
  now?: () => number;
}

/** Named versions must carry a usable label. */
export class CheckpointLabelError extends Error {
  constructor(readonly reason: 'empty' | 'too_long') {
    super(reason === 'empty' ? 'A checkpoint label must not be empty.' : `A checkpoint label must be at most ${CHECKPOINT_LABEL_MAX_LENGTH} characters.`);
    this.name = 'CheckpointLabelError';
  }
}

export type NamedCheckpointResult =
  /** The document changed since the latest checkpoint; a new snapshot was written. */
  | { outcome: 'created'; checkpointId: string }
  /** State identical to the latest checkpoint; the label was attached to that snapshot instead of duplicating it. */
  | { outcome: 'labeled'; checkpointId: string };

interface LatestCheckpoint {
  id: string;
  stateVector: Uint8Array;
  createdAt: Date;
  title: string | null;
  state: Uint8Array;
}

interface TrackedDocument {
  /** Serializes every checkpoint write so automatic, unload and manual never interleave. */
  queue: Promise<unknown>;
  /** UserIds whose connections actually edited since the last checkpoint. */
  authors: Set<string>;
  lastCheckpointAt: number;
  /** Full encoded state (including the deletion set) of the latest checkpoint; null until one exists. */
  lastState: Uint8Array | null;
}

export type PageCheckpointExtension = Extension<PageCollaborationContext> & {
  /** Manual named version; idempotent for an unchanged document. */
  createNamedCheckpoint(scope: PageScope, label: string): Promise<NamedCheckpointResult>;
  restoreCheckpoint(scope: PageScope, checkpointId: string, actor: Actor, apply: (mutate: () => void, title: string | null) => Promise<void>): Promise<{ title: string | null; safetyCheckpointId: string }>;
};

function sameSnapshot(left: Uint8Array | null, right: Uint8Array): boolean {
  if (!left || left.length !== right.length) return false;
  return left.every((byte, index) => byte === right[index]);
}

/**
 * Checkpoint strategy for §5.2 history versions, as a self-contained
 * Hocuspocus extension that coexists with the B02 persistence hooks:
 *
 * - Automatic: every debounced store (a store implies real edits) checks the
 *   interval since the previous checkpoint. No timers — an idle document
 *   never writes; the threshold is evaluated when edits arrive.
 * - Session end: when the last connection drops and the document unloads,
 *   changes not captured by any checkpoint are checkpointed (beforeUnloadDocument
 *   runs after the final immediate store flushed doc_state).
 * - Manual: an explicit label; if the state is identical to the latest
 *   checkpoint the label attaches to that snapshot instead of duplicating it,
 *   so repeated calls converge to a single row.
 *
 * Snapshots are full states of the live GC-enabled document (same encoding as
 * doc_state), so Yjs garbage collection stays on and deleted content never
 * resurrects from a checkpoint. Authors are the connection contexts observed
 * editing since the last checkpoint; server-internal writes carry no
 * connection context and are recorded as state changes without an author —
 * attribution is never fabricated.
 */
export function pageCheckpointExtension(deps: { pool: Pool }, policy: PageCheckpointPolicy = {}): PageCheckpointExtension {
  const intervalMs = policy.intervalMs ?? CHECKPOINT_INTERVAL_MS;
  const now = policy.now ?? Date.now;
  let instance: Hocuspocus | undefined;
  const tracked = new Map<string, TrackedDocument>();

  function stateFor(documentName: string): TrackedDocument {
    let state = tracked.get(documentName);
    if (!state) {
      state = { queue: Promise.resolve(), authors: new Set(), lastCheckpointAt: now(), lastState: null };
      tracked.set(documentName, state);
    }
    return state;
  }

  function enqueue<T>(documentName: string, task: () => Promise<T>): Promise<T> {
    const state = stateFor(documentName);
    const run = state.queue.then(task, task);
    state.queue = run.catch(() => undefined);
    return run;
  }

  async function latestCheckpoint(scope: PageScope): Promise<LatestCheckpoint | undefined> {
    const rows = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, (db) => db
      .select({ id: docCheckpoint.id, stateVector: docCheckpoint.stateVector, createdAt: docCheckpoint.createdAt, title: docCheckpoint.title, state: docCheckpoint.state })
      .from(docCheckpoint)
      .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId)))
      .orderBy(desc(docCheckpoint.createdAt), desc(docCheckpoint.id))
      .limit(1));
    return rows[0];
  }

  async function insertCheckpoint(scope: PageScope, snapshot: Uint8Array, vector: Uint8Array, authors: string[], label: string | null): Promise<string> {
    const id = randomUUID();
    await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async (db) => {
      const [metadata] = await db.select({ title: page.title }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
      return db.insert(docCheckpoint).values({
        knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, id,
        state: snapshot, stateVector: vector, authors, label, title: metadata?.title ?? null,
      });
    });
    return id;
  }

  async function relabelCheckpoint(scope: PageScope, checkpointId: string, label: string): Promise<void> {
    await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, (db) => db.update(docCheckpoint)
      .set({ label })
      .where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.id, checkpointId))));
  }

  /** Writes a snapshot and advances the interval window. */
  async function recordCheckpoint(scope: PageScope, state: TrackedDocument, document: Y.Doc, label: string | null): Promise<string> {
    const vector = Y.encodeStateVector(document);
    const snapshot = Y.encodeStateAsUpdate(document), authors = state.authors;
    state.authors = new Set();
    let id: string;
    try { id = await insertCheckpoint(scope, snapshot, vector, [...authors], label); }
    catch (error) { for (const author of authors) state.authors.add(author); throw error; }
    state.lastState = snapshot;
    state.lastCheckpointAt = now();
    return id;
  }

  return {
    extensionName: 'fob-page-checkpoints',

    async onConfigure(data) {
      instance = data.instance;
    },

    /** The interval continues across host restarts: the latest checkpoint anchors it. */
    async afterLoadDocument(data) {
      const scope = parsePageDocument(data.documentName);
      if (!scope) return;
      const latest = await latestCheckpoint(scope);
      const anchor = latest ? Math.min(latest.createdAt.getTime(), now()) : now();
      const state = tracked.get(data.documentName);
      if (state) {
        state.lastCheckpointAt = anchor;
        state.lastState = latest?.state ?? null;
      } else {
        tracked.set(data.documentName, { queue: Promise.resolve(), authors: new Set(), lastCheckpointAt: anchor, lastState: latest?.state ?? null });
      }
    },

    async onChange(data) {
      // Only genuine connection contexts attribute authorship; relayed or
      // server-internal updates still change state but add no author.
      const userId = data.context?.authority?.actor?.userId ?? (data.context as unknown as { actor?: Actor })?.actor?.userId;
      if (typeof userId === 'string' && userId) stateFor(data.documentName).authors.add(userId);
    },

    /** Runs after the B02 doc_state store committed, so a checkpoint never leads the body. */
    async afterStoreDocument(data) {
      const scope = parsePageDocument(data.documentName);
      if (!scope) return;
      const document = data.document;
      await enqueue(data.documentName, async () => {
        const state = stateFor(data.documentName);
        const vector = Y.encodeStateAsUpdate(document);
        if (sameSnapshot(state.lastState, vector)) return;
        if (now() - state.lastCheckpointAt < intervalMs) return;
        await recordCheckpoint(scope, state, document, null);
      });
    },

    /** Last connection gone: preserve changes no checkpoint captured yet. */
    async beforeUnloadDocument(data) {
      const scope = parsePageDocument(data.documentName);
      if (!scope) return;
      const document = data.document;
      const state = tracked.get(data.documentName);
      if (!state) return;
      await enqueue(data.documentName, async () => {
        // A virgin document (no operations ever) has nothing to checkpoint. A
        // failed write rethrows on purpose: the hook rejects, Hocuspocus keeps
        // the document loaded, and the tracking state survives for a retry.
        if (document.store.clients.size !== 0 || state.lastState) {
          const vector = Y.encodeStateAsUpdate(document);
          if (!sameSnapshot(state.lastState, vector)) await recordCheckpoint(scope, state, document, null);
        }
        if (tracked.get(data.documentName) === state) tracked.delete(data.documentName);
      });
    },

    async createNamedCheckpoint(scope: PageScope, label: string): Promise<NamedCheckpointResult> {
      const trimmed = label.trim();
      if (!trimmed) throw new CheckpointLabelError('empty');
      if (trimmed.length > CHECKPOINT_LABEL_MAX_LENGTH) throw new CheckpointLabelError('too_long');

      const documentName = pageDocumentName(scope);
      const [metadata] = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, db => db.select({ title: page.title }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))));
      const hosted = instance?.documents.get(documentName);
      if (hosted && !hosted.isLoading) {
        const document = hosted;
        return enqueue(documentName, async () => {
          const state = stateFor(documentName);
          const vector = Y.encodeStateAsUpdate(document);
          const latest = await latestCheckpoint(scope);
          if (sameSnapshot(state.lastState, vector) && latest && sameSnapshot(latest.state, vector) && latest.title === metadata?.title) {
            await relabelCheckpoint(scope, latest.id, trimmed);
            return { outcome: 'labeled', checkpointId: latest.id };
          }
          const checkpointId = await recordCheckpoint(scope, state, document, trimmed);
          return { outcome: 'created', checkpointId };
        });
      }

      // Not hosted: name the committed doc_state authority. Authors of past
      // intervals are not reconstructible offline, so the row records none.
      const source = new Y.Doc();
      try {
        const rows = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, (db) => db
          .select({ state: docState.state })
          .from(docState)
          .where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId))));
        if (rows[0]) Y.applyUpdate(source, rows[0].state);
        const vector = Y.encodeStateVector(source);
        const latest = await latestCheckpoint(scope);
        if (latest && sameSnapshot(latest.state, Y.encodeStateAsUpdate(source)) && latest.title === metadata?.title) {
          await relabelCheckpoint(scope, latest.id, trimmed);
          return { outcome: 'labeled', checkpointId: latest.id };
        }
        return { outcome: 'created', checkpointId: await insertCheckpoint(scope, Y.encodeStateAsUpdate(source), vector, [], trimmed) };
      } finally { source.destroy(); }
    },
    async restoreCheckpoint(scope, checkpointId, actor, apply) {
      if (!instance) throw new Error('Collaboration host unavailable');
      const [checkpoint] = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, db => db.select().from(docCheckpoint).where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId), eq(docCheckpoint.id, checkpointId))));
      const target = checkpoint && (yStateToProseMirrorDoc(checkpoint.state, knowledgeSchema) ?? knowledgeSchema.topNodeType.createAndFill());
      if (!target) throw new Error('Checkpoint unavailable');
      const name = pageDocumentName(scope);
      const context: { pageId: string; actor?: Actor } = { pageId: scope.pageId };
      const connection = await instance.openDirectConnection(name, context);
      try {
        const safetyCheckpointId = await enqueue(name, async () => {
          const state = stateFor(name), document = connection.document!;
          // Preserve all uncheckpointed edits before replacing the live fragment.
          const safety = await recordCheckpoint(scope, state, document, 'Before restore');
          await apply(() => {
            context.actor = actor;
            void connection.transact(live => {
              const fragment = live.getXmlFragment(PAGE_BODY_FRAGMENT);
              fragment.delete(0, fragment.length);
              const nodes: Parameters<typeof insertProseMirrorBlocks>[2][number][] = [];
              target.forEach(node => nodes.push(node));
              insertProseMirrorBlocks(fragment, 0, nodes);
            });
          }, checkpoint.title);
          return safety;
        });
        // A successful HTTP reply must follow the synchronous durable store.
        await connection.disconnect();
        return { title: checkpoint.title, safetyCheckpointId };
      } finally { if (connection.document) await connection.disconnect(); }
    },
  };
}

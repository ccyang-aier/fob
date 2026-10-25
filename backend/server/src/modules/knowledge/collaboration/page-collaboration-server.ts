import * as Y from 'yjs';
import { Hocuspocus } from '@hocuspocus/server';
import type { Configuration } from '@hocuspocus/server';
import { and, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { appendKnowledgeOutbox } from '../workers/outbox';
import type { KnowledgeRequestAuthenticator } from '../access';
import { pageCollaborationExtension } from './page-collaboration';
import type { PageCollaborationContext } from './page-collaboration';
import { parsePageDocument } from '@fob/shared/knowledge/collaboration';
import { pageCollaborationRedisExtension } from './page-collaboration-redis';
import type { PageCollaborationBroadcast } from './page-collaboration-redis';
import type { PageCheckpointExtension } from './checkpoints';
import { actorSchema } from '@fob/shared/knowledge/contracts';

export interface PageCollaborationPersistence {
  /** Store debounce window; production default 2s per the design contract. */
  debounceMs?: number;
  /** Upper bound so continuous editing still persists; production 10s. */
  maxDebounceMs?: number;
}

/**
 * Shared configuration for every embedding: Z03's listener, B03's multi-node
 * host and tests all spread this onto their Hocuspocus/Server construction.
 * Yjs garbage collection stays enabled; doc_state is the only body authority,
 * and state, state vector and the doc.changed outbox row commit atomically.
 * A broadcast setting enables the official Redis fan-out: updates arriving
 * through it skip the store hooks, and a Redlock keeps simultaneous stores
 * single-writer, so the persistence path below stays the only one.
 */
export function pageCollaborationConfiguration(deps: { authenticator: KnowledgeRequestAuthenticator; pool: Pool }, persistence: PageCollaborationPersistence = {}, broadcast?: PageCollaborationBroadcast, checkpoints?: PageCheckpointExtension): Partial<Configuration<PageCollaborationContext>> {
  const collaboration = pageCollaborationExtension(deps);
  return {
    name: 'fob-page-collaboration',
    debounce: persistence.debounceMs ?? 2_000,
    maxDebounce: persistence.maxDebounceMs ?? 10_000,
    extensions: [...(broadcast ? [pageCollaborationRedisExtension(broadcast)] : []), ...(checkpoints ? [checkpoints] : [])],
    yDocOptions: { gc: true, gcFilter: () => true },
    async onConnect(data) {
      return collaboration.onConnect?.(data);
    },
    async onLoadDocument(data) {
      const scope = parsePageDocument(data.documentName);
      if (!scope) return data.document;
      const row = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, (db) => db.select({ state: docState.state })
        .from(docState).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId))));
      if (row[0]) Y.applyUpdate(data.document, new Uint8Array(row[0].state));
      return data.document;
    },
    async onStoreDocument(data) {
      const scope = parsePageDocument(data.documentName);
      if (!scope) return;
      const state = Buffer.from(Y.encodeStateAsUpdate(data.document));
      const stateVector = Buffer.from(Y.encodeStateVector(data.document));
      // Server-internal stores without a connection context persist the body
      // but emit no event: actor attribution must never be fabricated.
      const attribution = actorSchema.safeParse(data.lastContext?.authority?.actor ?? (data.lastContext as unknown as { actor?: unknown } | undefined)?.actor);
      const actor = attribution.success ? attribution.data : undefined;
      await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async (db) => {
        await db.insert(docState).values({ ...scope, state, stateVector })
          .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: sql`clock_timestamp()` } });
        if (actor) await appendKnowledgeOutbox(db, { topic: 'doc.changed', ...scope, actor, occurredAt: new Date().toISOString() });
      });
    },
  };
}

/** A standalone host without a listener; Z03 owns real sockets. */
export function createPageCollaboration(deps: { authenticator: KnowledgeRequestAuthenticator; pool: Pool }, persistence: PageCollaborationPersistence = {}, broadcast?: PageCollaborationBroadcast, checkpoints?: PageCheckpointExtension): Hocuspocus<PageCollaborationContext> {
  return new Hocuspocus<PageCollaborationContext>(pageCollaborationConfiguration(deps, persistence, broadcast, checkpoints) as Partial<Configuration<PageCollaborationContext>>);
}

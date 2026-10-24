import { TRPCError } from '@trpc/server';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import type { Pool } from 'pg';
import type { KnowledgeRequestAuthenticator, KnowledgeRequestContext, KnowledgeTokenScope } from '../access';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { assertRequestActive } from './lifetime';

export interface KnowledgeApiContext {
  readonly requestId: string;
  readonly signal: AbortSignal;
}

/** Credential scopes are not page ACL. P03 must authorize page operations inside the resource callback. */
export interface KnowledgeProcedureContext extends KnowledgeApiContext {
  readonly authority: KnowledgeRequestContext;
  withResource<T>(operation: (db: ResourceTransaction, authority: KnowledgeRequestContext) => Promise<T>): Promise<T>;
}

const contexts = new WeakMap<KnowledgeApiContext, {
  authenticator: KnowledgeRequestAuthenticator;
  authority: KnowledgeRequestContext;
  pool: Pool;
}>();

export async function createKnowledgeApiContext(options: {
  request: Request;
  knowledgeBaseId: string;
  requestId: string;
  signal: AbortSignal;
  authenticator: KnowledgeRequestAuthenticator;
  pool: Pool;
}): Promise<KnowledgeApiContext> {
  assertRequestActive(options.signal);
  const authority = await options.authenticator.authenticate(options.request, options.knowledgeBaseId);
  assertRequestActive(options.signal);
  const context = Object.freeze({ requestId: options.requestId, signal: options.signal });
  contexts.set(context, { authenticator: options.authenticator, pool: options.pool, authority });
  return context;
}

export async function authorizeKnowledgeProcedure(context: KnowledgeApiContext, knowledgeBaseId: string, scopes: readonly KnowledgeTokenScope[]): Promise<KnowledgeProcedureContext> {
  const state = contexts.get(context);
  if (!state) throw new TRPCError({ code: 'UNAUTHORIZED' });
  assertRequestActive(context.signal);
  const target = entityIdSchema.safeParse(knowledgeBaseId);
  if (!target.success) throw new TRPCError({ code: 'BAD_REQUEST' });
  if (target.data.toLowerCase() !== state.authority.knowledgeBaseId) throw new TRPCError({ code: 'FORBIDDEN' });
  // Batch calls share a transport, not a permission snapshot. Refresh each call independently.
  const authority = await state.authenticator.refresh(state.authority, scopes);
  assertRequestActive(context.signal);
  return Object.freeze({
    ...context, authority,
    async withResource<T>(operation: (db: ResourceTransaction, authority: KnowledgeRequestContext) => Promise<T>): Promise<T> {
      assertRequestActive(context.signal);
      // A handler may perform a second operation later; refresh before every new transaction too.
      const current = await state.authenticator.refresh(authority, scopes);
      assertRequestActive(context.signal);
      return withKnowledgeBase(state.pool, current.knowledgeBaseId, async (db) => {
        assertRequestActive(context.signal);
        const result = await operation(db, current);
        // Cancellation observed before COMMIT rolls back. Already committed writes cannot be undone.
        assertRequestActive(context.signal);
        return result;
      });
    },
  });
}

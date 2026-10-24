import { initTRPC, TRPCError } from '@trpc/server';
import type { AnyTRPCProcedure, AnyTRPCRouter, TRPCRouterRecord } from '@trpc/server';
import type { z } from 'zod';
import { knowledgeTokenScopes } from '../access';
import type { KnowledgeTokenScope } from '../access';
import { apiError, apiErrorShape } from './errors';
import { authorizeKnowledgeProcedure } from './context';
import type { KnowledgeApiContext, KnowledgeProcedureContext } from './context';
import { assertRequestActive } from './lifetime';

const trpc = initTRPC.context<KnowledgeApiContext>().create({
  isDev: false,
  errorFormatter: ({ error, ctx }) => apiErrorShape(error, ctx?.requestId ?? null),
});
const protectedProcedures = new WeakSet<AnyTRPCProcedure>();
const protectedRouters = new WeakSet<AnyTRPCRouter>();

type ScopedSchema = z.ZodType<{ knowledgeBaseId: string }>;
type Definition<TSchema extends ScopedSchema, TOutput> = {
  /** Complete input schema; use strictObject to reject unsolicited fields. */
  input: TSchema;
  scopes: readonly [KnowledgeTokenScope, ...KnowledgeTokenScope[]];
  resolve(options: { input: z.output<TSchema>; ctx: KnowledgeProcedureContext }): TOutput | Promise<TOutput>;
};

function resolver<TSchema extends ScopedSchema, TOutput>(definition: Definition<TSchema, TOutput>) {
  const scopes = Object.freeze([...definition.scopes]);
  if (!scopes.length || new Set(scopes).size !== scopes.length || scopes.some((scope) => !knowledgeTokenScopes.includes(scope))) {
    throw new TypeError('Knowledge procedures require distinct explicit credential scopes.');
  }
  return async ({ ctx, input }: { ctx: KnowledgeApiContext; input: z.output<TSchema> }) => {
    let authorized: KnowledgeProcedureContext | undefined;
    try {
      authorized = await authorizeKnowledgeProcedure(ctx, input.knowledgeBaseId, scopes);
      const result = await definition.resolve({ input, ctx: authorized });
      assertRequestActive(authorized.signal);
      return result;
    } catch (error) {
      // Downstream fetch/database work may reject with a generic AbortError instead of our code.
      if (authorized) assertRequestActive(authorized.signal);
      throw apiError(error);
    }
  };
}

export function knowledgeQuery<TSchema extends ScopedSchema, TOutput>(definition: Definition<TSchema, TOutput>) {
  const run = resolver(definition);
  const procedure = trpc.procedure.input(definition.input).query(({ ctx, input }) => run({ ctx, input: input as z.output<TSchema> }));
  protectedProcedures.add(procedure);
  return procedure;
}

export function knowledgeMutation<TSchema extends ScopedSchema, TOutput>(definition: Definition<TSchema, TOutput>) {
  const run = resolver(definition);
  const procedure = trpc.procedure.input(definition.input).mutation(({ ctx, input }) => run({ ctx, input: input as z.output<TSchema> }));
  protectedProcedures.add(procedure);
  return procedure;
}

/** No public-procedure escape hatch: even a nested route must come from these factories. */
export function createKnowledgeRouter<TRecord extends TRPCRouterRecord>(record: TRecord) {
  function validate(routes: TRPCRouterRecord) {
    for (const entry of Object.values(routes)) {
      if (typeof entry === 'function') {
        if (!protectedProcedures.has(entry)) throw new TypeError('Unprotected knowledge procedure.');
      } else validate(entry);
    }
  }
  validate(record);
  const router = trpc.router(record);
  protectedRouters.add(router);
  return router;
}

export function assertKnowledgeRouter(router: AnyTRPCRouter) {
  if (!protectedRouters.has(router)) throw new TypeError('Use createKnowledgeRouter for the knowledge HTTP boundary.');
  // Detect accidental post-construction replacement as well as foreign routers.
  for (const procedure of Object.values(router._def.procedures)) {
    if (typeof procedure !== 'function' || !protectedProcedures.has(procedure as AnyTRPCProcedure)) {
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Unprotected knowledge procedure.' });
    }
  }
}

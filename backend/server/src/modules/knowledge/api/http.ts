import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { TRPCError } from '@trpc/server';
import type { AnyTRPCRouter } from '@trpc/server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { entityIdSchema } from '@fob/shared/knowledge/contracts';
import { createKnowledgeRequestAuthenticator } from '../access';
import type { KnowledgeAccessDependencies } from '../access';
import { apiError, apiErrorResponse, reportApiError } from './errors';
import type { KnowledgeApiDiagnostic } from './errors';
import { createKnowledgeApiContext } from './context';
import { assertKnowledgeRouter } from './procedures';
import { assertRequestActive, createRequestLifetime } from './lifetime';
import { boundedJsonRequest, checkRequestOrigin, finalizeApiResponse, knowledgeApiLimits, preflightResponse } from './transport';
import { knowledgeApiRouter } from './router';

export const knowledgeApiBasePath = '/api/knowledge';
export interface KnowledgeApiOptions extends Pick<KnowledgeAccessDependencies, 'auth' | 'pool'> {
  /** The R01 role signal; this factory does not own the listener or database pool. */
  signal?: AbortSignal;
  router?: AnyTRPCRouter;
  onDiagnostic?: (event: KnowledgeApiDiagnostic) => void;
}

/** Mount with app.route('/', createKnowledgeApiRoutes(...)); Z03 owns the shared HTTP listener. */
export function createKnowledgeApiRoutes(options: KnowledgeApiOptions): Hono {
  const router = options.router ?? knowledgeApiRouter;
  assertKnowledgeRouter(router);
  const authenticator = createKnowledgeRequestAuthenticator({ auth: options.auth, pool: options.pool });
  const origins = Object.freeze([...(options.auth.options.trustedOrigins as string[])]);
  const app = new Hono();
  const handle = async (context: Context) => {
    const request = context.req.raw;
    const requestId = randomUUID();
    const lifetime = createRequestLifetime(request.signal, options.signal);
    let response: Response;
    try {
      assertRequestActive(lifetime.signal);
      checkRequestOrigin(request, origins);
      if (new TextEncoder().encode(request.url).byteLength > knowledgeApiLimits.urlBytes) throw new TRPCError({ code: 'PAYLOAD_TOO_LARGE' });
      const match = /^\/api\/knowledge\/([a-zA-Z0-9-]+)\/trpc(?:\/|$)/.exec(new URL(request.url).pathname);
      if (!match || !entityIdSchema.safeParse(match[1]).success) throw new TRPCError({ code: 'BAD_REQUEST' });
      const knowledgeBaseId = match[1]!;
      if (request.method === 'OPTIONS') response = preflightResponse(request);
      else {
        if (!['GET', 'POST'].includes(request.method)) throw new TRPCError({ code: 'METHOD_NOT_SUPPORTED' });
        // This boundary is finite JSON RPC. Collaboration/streaming use their separate transports.
        if (request.headers.has('trpc-accept') || request.headers.get('accept')?.includes('text/event-stream')) throw new TRPCError({ code: 'UNSUPPORTED_MEDIA_TYPE' });
        const bounded = await boundedJsonRequest(request, lifetime.signal, knowledgeApiLimits.bodyBytes);
        response = await fetchRequestHandler({
          endpoint: `${knowledgeApiBasePath}/${knowledgeBaseId}/trpc`, req: bounded, router,
          allowMethodOverride: false, allowBatching: true, maxBatchSize: knowledgeApiLimits.batchSize,
          createContext: async () => {
            try { return await createKnowledgeApiContext({ request: bounded, knowledgeBaseId, requestId, signal: lifetime.signal, authenticator, pool: options.pool }); }
            catch (error) { assertRequestActive(lifetime.signal); throw apiError(error); }
          },
          onError: ({ error }) => reportApiError(error, requestId, options.onDiagnostic),
          responseMeta: ({ errors }) => ({ headers: new Headers(errors.some((error) => error.code === 'UNAUTHORIZED') ? { 'WWW-Authenticate': 'Bearer realm="knowledge"' } : {}) }),
        });
      }
    } catch (error) {
      reportApiError(error, requestId, options.onDiagnostic);
      response = apiErrorResponse(error, requestId);
    } finally { lifetime.dispose(); }
    return finalizeApiResponse(response, request, requestId, origins);
  };
  // Do not intercept organization/auth/media routes sharing the knowledge prefix.
  app.all(`${knowledgeApiBasePath}/:knowledgeBaseId/trpc`, handle);
  app.all(`${knowledgeApiBasePath}/:knowledgeBaseId/trpc/*`, handle);
  return app;
}

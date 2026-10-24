import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { createTRPCClient, httpBatchLink, httpLink } from '@trpc/client';
import { TRPCError } from '@trpc/server';
import { knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import { createAuthTestServer, responseCookie, testPassword } from '../../../platform/identity/auth-test-server';
import { createKnowledgeTokenService } from '../access';
import type { KnowledgeTokenScope } from '../access';
import { createKnowledgeApiRoutes } from './http';
import { createKnowledgeRouter, knowledgeMutation, knowledgeQuery } from './procedures';
import { knowledgeApiRouter } from './router';
import type { KnowledgeApiDiagnostic } from './errors';

export const privateErrorCanary = 'private-postgres-password-and-SQL';
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
export function heldOperation() {
  return { started: deferred<AbortSignal>(), release: deferred(), finished: deferred() };
}
export async function within<T>(promise: Promise<T>, milliseconds = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Test gate timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

/** Disposable DB + verified email/password flow + real Node HTTP. All extra procedures are test-only. */
export async function createApiTestServer() {
  const shutdown = new AbortController();
  const diagnostics: KnowledgeApiDiagnostic[] = [];
  const requests: string[] = [];
  const successfulSignals: AbortSignal[] = [];
  const held = new Map<string, ReturnType<typeof heldOperation>>();
  const inputGates = new Map<string, { entered: ReturnType<typeof deferred<void>>; release: ReturnType<typeof deferred<void>> }>();
  const router = createKnowledgeRouter({
    access: knowledgeApiRouter.access,
    probe: knowledgeQuery({
      input: knowledgeBaseScopeSchema.extend({ delayMs: z.number().int().min(0).max(100).default(0) }), scopes: ['read'],
      resolve: ({ input, ctx }) => ctx.withResource(async (db, authority) => {
        if (input.delayMs) await db.execute(sql`SELECT pg_sleep(${input.delayMs / 1_000})`);
        const rows = await db.execute<{ knowledgeBaseId: string; name: string; pid: number; resource: string; identity: string }>(sql`
          SELECT id AS "knowledgeBaseId", name, pg_backend_pid() AS pid,
            current_setting('app.knowledge_base_id', true) AS resource, current_setting('app.auth_session_id', true) AS identity
          FROM resources.knowledge_base`);
        successfulSignals.push(ctx.signal);
        return { rows: rows.rows, actor: authority.actor, role: authority.role };
      }),
    }),
    writeScope: knowledgeMutation({
      input: knowledgeBaseScopeSchema, scopes: ['write'],
      resolve: ({ ctx }) => ({ actor: ctx.authority.actor, knowledgeBaseId: ctx.authority.knowledgeBaseId }),
    }),
    failure: knowledgeMutation({
      input: knowledgeBaseScopeSchema, scopes: ['write'],
      resolve: ({ ctx }) => ctx.withResource(async (db) => {
        await db.execute(sql`UPDATE resources.knowledge_base SET name='should-roll-back'`);
        throw new Error(privateErrorCanary);
      }),
    }),
    hold: knowledgeMutation({
      input: knowledgeBaseScopeSchema.extend({ operationId: z.uuid() }), scopes: ['write'],
      resolve: async ({ input, ctx }) => {
        const control = held.get(input.operationId);
        if (!control) throw new TRPCError({ code: 'BAD_REQUEST' });
        try {
          return await ctx.withResource(async (db) => {
            await db.execute(sql`UPDATE resources.knowledge_base SET name=${input.operationId}`);
            const release = () => control.release.resolve();
            ctx.signal.addEventListener('abort', release, { once: true });
            if (ctx.signal.aborted) release();
            control.started.resolve(ctx.signal);
            try { await within(control.release.promise); }
            finally { ctx.signal.removeEventListener('abort', release); }
            if (ctx.signal.aborted) throw new Error('private downstream abort reason');
            return { completed: true };
          });
        } finally { control.finished.resolve(); }
      },
    }),
    delayedRead: knowledgeQuery({
      input: knowledgeBaseScopeSchema.extend({ operationId: z.uuid() }).transform(async (input) => {
        const gate = inputGates.get(input.operationId);
        if (!gate) throw new TRPCError({ code: 'BAD_REQUEST' });
        gate.entered.resolve();
        await within(gate.release.promise);
        return input;
      }),
      scopes: ['read'], resolve: ({ ctx }) => ctx.authority.userId,
    }),
    laterTransaction: knowledgeQuery({
      input: knowledgeBaseScopeSchema.extend({ operationId: z.uuid() }), scopes: ['read'],
      resolve: async ({ input, ctx }) => {
        const gate = inputGates.get(input.operationId);
        if (!gate) throw new TRPCError({ code: 'BAD_REQUEST' });
        gate.entered.resolve();
        await within(gate.release.promise);
        return ctx.withResource(async (_db, authority) => authority.role);
      },
    }),
  });
  let pool!: Pool;
  let tokens!: ReturnType<typeof createKnowledgeTokenService>;
  const server = await createAuthTestServer({ mount(app, { auth, database }) {
    // Multiple ordinary-role connections exercise simultaneous resource transactions as well as reuse.
    pool = new Pool({ ...database.pool.options, max: 4 });
    pool.on('error', () => { diagnostics.push({ requestId: 'pool', code: 'SERVICE_UNAVAILABLE', status: 503 }); });
    tokens = createKnowledgeTokenService({ auth, pool });
    app.use('/api/knowledge/*', async (context, next) => { requests.push(context.req.url); await next(); });
    app.route('/', createKnowledgeApiRoutes({ auth, pool, router, signal: shutdown.signal, onDiagnostic(event) {
      diagnostics.push(event);
      throw new Error('observer-private-canary'); // Observer errors must not alter the safe response.
    } }));
    // Registered afterwards on purpose: the tRPC module must not own this sibling route.
    app.get('/api/knowledge-bases', (context) => context.json({ handledBy: 'later-organization-router' }));
  } });
  async function account(email: string) {
    const signup = await server.request('/sign-up/email', { name: email, email, password: testPassword });
    assert.equal(signup.status, 200);
    const { user } = await signup.json() as { user: { id: string } };
    assert.equal((await server.request(server.verificationPath(email))).status, 302);
    const login = await server.request('/sign-in/email', { email, password: testPassword });
    assert.equal(login.status, 200);
    return { userId: user.id, cookie: responseCookie(login) };
  }
  try {
    const alpha = { ...await account('api-alpha@example.test'), knowledgeBaseId: randomUUID(), name: 'API Alpha' };
    const beta = { ...await account('api-beta@example.test'), knowledgeBaseId: randomUUID(), name: 'API Beta' };
    await server.database.admin.query("INSERT INTO resources.knowledge_base(id,name) VALUES ($1,$2),($3,$4)", [alpha.knowledgeBaseId, alpha.name, beta.knowledgeBaseId, beta.name]);
    await server.database.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES ($1,$3,'owner'),($2,$4,'owner'),($2,$3,'member')", [alpha.knowledgeBaseId, beta.knowledgeBaseId, alpha.userId, beta.userId]);
    const url = (knowledgeBaseId: string = alpha.knowledgeBaseId) => `${server.origin}/api/knowledge/${knowledgeBaseId}/trpc`;
    return {
      server, alpha, beta, pool, shutdown, diagnostics, requests, successfulSignals, held, inputGates, router, url,
      client(headers: Record<string, string> = {}, knowledgeBaseId: string = alpha.knowledgeBaseId) {
        return createTRPCClient<typeof router>({ links: [httpLink({ url: url(knowledgeBaseId), headers })] });
      },
      batchClient(headers: Record<string, string>) {
        return createTRPCClient<typeof router>({ links: [httpBatchLink({ url: url(), headers, maxItems: 10 })] });
      },
      createToken(scopes: KnowledgeTokenScope[] = ['read'], resource = alpha) {
        return tokens.create(new Request(`${server.origin}/test-token-setup`, { method: 'POST', headers: { origin: server.webOrigin, cookie: resource.cookie } }),
          { knowledgeBaseId: resource.knowledgeBaseId, name: 'HTTP test', scopes, expiresAt: null });
      },
      async close() {
        shutdown.abort();
        for (const control of held.values()) control.release.resolve();
        for (const gate of inputGates.values()) gate.release.resolve();
        await pool.end();
        await server.close();
      },
    };
  } catch (error) {
    await pool.end();
    await server.close();
    throw error;
  }
}

export type ApiTestServer = Awaited<ReturnType<typeof createApiTestServer>>;

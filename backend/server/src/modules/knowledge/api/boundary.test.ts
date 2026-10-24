import { describe, expect, test } from 'bun:test';
import { getEventListeners } from 'node:events';
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { initTRPC, TRPCError } from '@trpc/server';
import { knowledgeBaseScopeSchema } from '@fob/shared/knowledge/contracts';
import { bindAuthTestRequestLifetime } from '../../../platform/identity/auth-test-server';
import { createKnowledgeRouter, knowledgeQuery, assertKnowledgeRouter } from './procedures';
import { createRequestLifetime, assertRequestActive } from './lifetime';
import { boundedJsonRequest } from './transport';
import { apiErrorShape } from './errors';

describe('knowledge API construction and finite request boundary', () => {
  test('rejects foreign/public procedures and routers, including nested routes', () => {
    const publicTRPC = initTRPC.create();
    const foreign = publicTRPC.procedure.query(() => 'unprotected');
    expect(() => createKnowledgeRouter({ nested: { unsafe: foreign } })).toThrow('Unprotected knowledge procedure');
    expect(() => assertKnowledgeRouter(publicTRPC.router({ unsafe: foreign }))).toThrow('Use createKnowledgeRouter');
    const router = createKnowledgeRouter({ safe: knowledgeQuery({ input: knowledgeBaseScopeSchema, scopes: ['read'], resolve: () => 'ok' }) });
    expect(() => assertKnowledgeRouter(router)).not.toThrow();
    // A post-construction replacement must not evade the mount-time audit either.
    Object.assign(router._def.procedures, { unsafe: foreign });
    expect(() => assertKnowledgeRouter(router)).toThrow('Unprotected knowledge procedure');
  });

  test('requires explicit, distinct, supported scopes even from untyped server callers', () => {
    for (const scopes of [[], ['read', 'read'], ['admin']]) {
      expect(() => knowledgeQuery({ input: knowledgeBaseScopeSchema, scopes: scopes as ['read'], resolve: () => null })).toThrow('distinct explicit credential scopes');
    }
  });

  test('a copied or fabricated tRPC context is not authentication', async () => {
    const router = createKnowledgeRouter({ safe: knowledgeQuery({ input: knowledgeBaseScopeSchema, scopes: ['read'], resolve: () => 'should not run' }) });
    await expect(router.createCaller({ requestId: 'forged', signal: new AbortController().signal }).safe({ knowledgeBaseId: '20000000-0000-4000-8000-000000000000' }))
      .rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  });

  test('error formatter does not preserve raw message, stack, cause, path, SQL or input', () => {
    const error = new TRPCError({ code: 'BAD_REQUEST', message: 'secret-input', cause: new Error('private SQL and password') });
    expect(apiErrorShape(error, 'server-request')).toEqual({
      message: 'Invalid request input.', code: -32600,
      data: { code: 'BAD_REQUEST', httpStatus: 400, requestId: 'server-request' },
    });
    expect(apiErrorShape(new Error('database password'), null).data.code).toBe('INTERNAL_SERVER_ERROR');
  });

  test('lifetime combines shutdown/request cancellation and cleans both signal listeners', () => {
    const request = new AbortController();
    const shutdown = new AbortController();
    const lifetime = createRequestLifetime(request.signal, shutdown.signal);
    expect(getEventListeners(request.signal, 'abort')).toHaveLength(1);
    expect(getEventListeners(shutdown.signal, 'abort')).toHaveLength(1);
    request.abort(new Error('untrusted transport reason'));
    expect(() => assertRequestActive(lifetime.signal)).toThrow('CLIENT_CLOSED_REQUEST');
    lifetime.dispose();
    lifetime.dispose();
    expect(getEventListeners(request.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(shutdown.signal, 'abort')).toHaveLength(0);
    const stopping = createRequestLifetime(new AbortController().signal, shutdown.signal);
    shutdown.abort();
    expect(() => assertRequestActive(stopping.signal)).toThrow('SERVICE_UNAVAILABLE');
    stopping.dispose();
    const alreadyStopped = createRequestLifetime(new AbortController().signal, shutdown.signal);
    expect(() => assertRequestActive(alreadyStopped.signal)).toThrow('SERVICE_UNAVAILABLE');
    alreadyStopped.dispose();
  });

  test('normal completion only removes listeners; it is not a cancellation', () => {
    const source = new AbortController();
    const role = new AbortController();
    const lifetime = createRequestLifetime(source.signal, role.signal);
    lifetime.dispose();
    expect(lifetime.signal.aborted).toBe(false);
    expect(getEventListeners(source.signal, 'abort')).toHaveLength(0);
    expect(getEventListeners(role.signal, 'abort')).toHaveLength(0);
    source.abort();
    role.abort();
    expect(lifetime.signal.aborted).toBe(false);
  });

  test('the real Node adapter bridge handles incoming abort, disconnected response, normal end and cleanup', () => {
    for (const event of ['aborted', 'disconnected', 'completed'] as const) {
      const socket = new Socket();
      const request = new IncomingMessage(socket);
      const response = new ServerResponse(request);
      const before = { request: request.listenerCount('aborted'), response: response.listenerCount('close') };
      const lifetime = bindAuthTestRequestLifetime(request, response);
      expect(request.listenerCount('aborted')).toBe(before.request + 1);
      expect(response.listenerCount('close')).toBe(before.response + 1);
      if (event === 'aborted') request.emit('aborted');
      else {
        if (event === 'completed') response.end();
        response.emit('close');
      }
      expect(lifetime.signal.aborted).toBe(event !== 'completed');
      lifetime.dispose();
      expect(request.listenerCount('aborted')).toBe(before.request);
      expect(response.listenerCount('close')).toBe(before.response);
      socket.destroy();
    }
  });

  test('body cap counts real bytes, not declared length, and cancels oversized streams', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('汉字超限')); },
      cancel() { cancelled = true; },
    });
    const request = new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': '1' }, body: stream, duplex: 'half' });
    await expect(boundedJsonRequest(request, request.signal, 8)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toBe(true);
    expect(getEventListeners(request.signal, 'abort')).toHaveLength(0);
  });

  test('body read abort releases an otherwise idle stream and its listener', async () => {
    const controller = new AbortController();
    let cancelled = false;
    const request = new Request('http://localhost/test', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: new ReadableStream({ cancel() { cancelled = true; } }), duplex: 'half' });
    const result = boundedJsonRequest(request, controller.signal, 8);
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: 'CLIENT_CLOSED_REQUEST' });
    expect(cancelled).toBe(true);
    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });
});

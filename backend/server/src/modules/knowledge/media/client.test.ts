import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createMediaWorkerClient, MediaWorkerError, mediaProcessResponseSchema } from './client';
import type { MediaProcessRequest } from './client';

const token = 'test-only-' + 'x'.repeat(32);
const input = (): MediaProcessRequest => ({
  requestId: randomUUID(), operation: 'parse_document', timeoutMs: 1000,
  resource: { url: 'https://storage.test/object?signature=do-not-echo', expiresAt: new Date(Date.now() + 60_000).toISOString(), sha256: 'a'.repeat(64), size: 10, mime: 'application/pdf' },
});
const success = (body: MediaProcessRequest) => ({ requestId: body.requestId, operation: body.operation, assetHash: body.resource.sha256, derived: { status: 'ready', markdown: 'protocol fixture only' }, processor: 'test', elapsedMs: 1 });
const failure = (code: string, status: number, retryable = false) => Response.json({ requestId: null, error: { code, message: 'sanitized error', retryable } }, { status });
const client = (fetcher: (url: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => Promise<Response>, overrides = {}) => createMediaWorkerClient({ baseUrl: 'http://127.0.0.1:8910', token, fetch: fetcher as typeof fetch, ...overrides });
const hasCode = (code: string) => (error: unknown) => error instanceof MediaWorkerError && error.code === code;

test('HTTP client sends bounded contract and validates response identity', async () => {
  const body = input();
  const connection = client(async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:8910/v1/process');
    assert.equal(init?.redirect, 'error');
    assert.equal((init?.headers as Record<string, string>).authorization, `Bearer ${token}`);
    assert.deepEqual(JSON.parse(String(init?.body)), body);
    return Response.json(success(body));
  });
  assert.equal((await connection.process(body)).derived.markdown, 'protocol fixture only');
  await assert.rejects(client(async () => Response.json(success({ ...body, requestId: randomUUID() }))).process(body), hasCode('protocol_error'));
});

test('strict result reuses shared asset derivation and timestamp validation', () => {
  const body = input();
  assert.equal(mediaProcessResponseSchema.safeParse({ ...success(body), derived: { status: 'processing' } }).success, false);
  assert.equal(mediaProcessResponseSchema.safeParse({ ...success(body), derived: { status: 'ready', markdown: '', ocr: 'unexpected' } }).success, false);
  assert.equal(mediaProcessResponseSchema.safeParse({ ...success(body), operation: 'transcribe', derived: { status: 'ready', transcript: [{ start: 5, end: 1, text: 'bad' }] } }).success, false);
});

test('client rejects malformed input/config without exposing URLs or tokens', async () => {
  assert.throws(() => createMediaWorkerClient({ baseUrl: 'http://secret:password@worker', token: 'sensitive' }), /Invalid Media Worker client configuration/);
  let called = false;
  const connection = client(async () => { called = true; throw new Error('not expected'); });
  await assert.rejects(connection.process({ ...input(), unexpected: 'private-value' } as MediaProcessRequest), hasCode('invalid_request'));
  assert.equal(called, false);
});

test('wire errors keep retry semantics but do not echo sensitive upstream content', async () => {
  await assert.rejects(client(async () => failure('worker_busy', 429, true)).process(input()), (error: unknown) => error instanceof MediaWorkerError && error.retryable && error.status === 429);
  await assert.rejects(client(async () => Response.json({ private: token }, { status: 500 })).process(input()), hasCode('protocol_error'));
  await assert.rejects(client(async () => { throw new Error(`network failure ${token}`); }).process(input()), (error: unknown) => error instanceof MediaWorkerError && error.code === 'transport_error' && !error.message.includes(token));
});

test('bounded response reads reject oversized and non-JSON responses', async () => {
  await assert.rejects(client(async () => Response.json({ data: 'x'.repeat(2048) }), { maxResponseBytes: 1024 }).process(input()), hasCode('protocol_error'));
  await assert.rejects(client(async () => new Response('private upstream HTML')).process(input()), hasCode('protocol_error'));
});

test('network timeout and caller abort cancel the server task explicitly', async () => {
  for (const callerAborts of [false, true]) {
    let cancellationCount = 0;
    const connection = client(async (_url, init) => {
      if (init?.method === 'DELETE') { cancellationCount++; return failure('task_not_found', 404); }
      return new Promise<Response>((_resolve, reject) => {
        const guard = setTimeout(() => reject(new Error('timeout guard')), 1000);
        init?.signal?.addEventListener('abort', () => { clearTimeout(guard); reject(new Error('fetch aborted')); }, { once: true });
      });
    }, { timeoutMs: callerAborts ? 1000 : 10 });
    const controller = new AbortController();
    if (callerAborts) setTimeout(() => controller.abort(), 10);
    await assert.rejects(connection.process(input(), controller.signal), hasCode(callerAborts ? 'task_cancelled' : 'task_timeout'));
    assert.equal(cancellationCount, 1);
  }
});

test('cancel validates IDs and treats completed tasks as absent', async () => {
  const connection = client(async () => failure('task_not_found', 404));
  assert.equal(await connection.cancel(randomUUID()), false);
  await assert.rejects(connection.cancel('../escape'), hasCode('invalid_request'));
});

test('processor configuration and media errors retain actionable retry semantics', async () => {
  for (const code of ['dependency_missing', 'model_unavailable', 'device_unavailable']) {
    await assert.rejects(client(async () => failure(code, 503)).process(input()),
      (error: unknown) => error instanceof MediaWorkerError && error.code === code && error.status === 503 && !error.retryable);
  }
  for (const code of ['invalid_media', 'unsupported_language', 'invalid_document', 'empty_document', 'unsupported_document_content']) {
    await assert.rejects(client(async () => failure(code, 422)).process(input()), hasCode(code));
  }
  await assert.rejects(client(async () => failure('media_too_long', 413)).process(input()), hasCode('media_too_long'));
  await assert.rejects(client(async () => failure('document_limit_exceeded', 413)).process(input()), hasCode('document_limit_exceeded'));
});

test('document attachments validate actual PNG metadata, hash, bytes and exact references', () => {
  // Generated by Pillow from one RGB pixel; not a parser/recognition substitute.
  const dataBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMQyY4HAAF1AN9xyHAEAAAAAElFTkSuQmCC';
  const bytes = Buffer.from(dataBase64, 'base64');
  const attachment = { sha256: createHash('sha256').update(bytes).digest('hex'), mime: 'image/png',
    size: bytes.length, width: 1, height: 1, dataBase64 };
  const response = { ...success(input()), derived: { status: 'ready', markdown: `![Image](asset:${attachment.sha256})` }, attachments: [attachment] };
  assert.ok(mediaProcessResponseSchema.safeParse(response).success);
  for (const change of [{ sha256: 'b'.repeat(64) }, { size: 1 }, { width: 2 }, { mime: 'image/jpeg' },
    { dataBase64: 'invalid' }, { width: 4_000_000, height: 2 }, { size: 1024 ** 2 + 1 }]) {
    assert.equal(mediaProcessResponseSchema.safeParse({ ...response, attachments: [{ ...attachment, ...change }] }).success, false);
  }
  for (const attachments of [[], [attachment, attachment], Array.from({ length: 33 }, () => attachment)]) {
    assert.equal(mediaProcessResponseSchema.safeParse({ ...response, attachments }).success, false);
  }
  assert.equal(mediaProcessResponseSchema.safeParse({ ...response, derived: { status: 'ready', markdown: 'No references' } }).success, false);
  assert.equal(mediaProcessResponseSchema.safeParse({ ...response, operation: 'transcribe', derived: { status: 'ready', transcript: [] } }).success, false);
});

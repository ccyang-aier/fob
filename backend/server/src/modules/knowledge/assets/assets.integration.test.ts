import { authUser } from '../../../platform/database/identity/schema';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { createResourceTestDatabase, type ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import * as tables from '../../../platform/database/resources/schema';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { confirmKnowledgeBaseAssetUpload, prepareKnowledgeBaseAssetUpload, presignKnowledgeBaseAssetDownload, revokeKnowledgeBaseAsset } from './service';
import { createKnowledgeAssetStorage, readKnowledgeAssetStorageConfig, type KnowledgeAssetStorage } from './storage';

/** Real MinIO round trips and a real disposable RLS database; ordinary app-role resource transactions only. */
describe('knowledgeBase asset upload, confirmation and presigned access', () => {
  let database: ResourceTestDatabase;
  let storage: KnowledgeAssetStorage;
  const alpha = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
  const beta = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
  const outsider = randomUUID();
  const objects: { knowledgeBaseId: string; hash: string }[] = [];
  const encoder = new TextEncoder();

  interface UploadFile { bytes: Uint8Array<ArrayBuffer>; mime: string; size: number; hash: string; name: string }
  function file(label: string, mime = 'text/plain'): UploadFile {
    const bytes = encoder.encode(`Fob AS01 acceptance ${label} — 知识库资产 ${randomUUID()}`);
    return { bytes, mime, size: bytes.byteLength, hash: createHash('sha256').update(bytes).digest('hex'), name: `${label}.txt` };
  }
  function register(knowledgeBaseId: string, uploaded: { hash: string }) { objects.push({ knowledgeBaseId, hash: uploaded.hash }); }
  const intent = (knowledgeBase: { knowledgeBaseId: string; userId: string }, uploaded: UploadFile) => ({
    knowledgeBaseId: knowledgeBase.knowledgeBaseId, userId: knowledgeBase.userId, hash: uploaded.hash, mime: uploaded.mime, size: uploaded.size, name: uploaded.name,
  });
  async function clientPut(url: string, mime: string, bytes: Uint8Array) {
    return fetch(url, { method: 'PUT', headers: { 'content-type': mime }, body: bytes });
  }
  async function assetRow(pool: Pool, knowledgeBaseId: string, hash: string) {
    return (await pool.query<{ status: string; size: string; mime: string; meta: { name?: string } }>(
      'SELECT status, size::text, mime, meta FROM resources.asset WHERE knowledge_base_id=$1 AND hash=$2', [knowledgeBaseId, hash],
    )).rows[0];
  }
  async function outboxCount(pool: Pool, topic: string, hash?: string) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text FROM resources.outbox WHERE topic=$1 AND ($2::text IS NULL OR payload->>'hash'=$2)`, [topic, hash ?? null],
    );
    return Number(result.rows[0]!.count);
  }
  async function jobCount(pool: Pool) {
    return Number((await pool.query<{ count: string }>('SELECT count(*)::text FROM knowledge_jobs._private_jobs')).rows[0]!.count);
  }

  beforeAll(async () => {
    storage = createKnowledgeAssetStorage(await readKnowledgeAssetStorageConfig());
    database = await createResourceTestDatabase();
    await initializeKnowledgeJobs(database.admin, database.pool);
    const client = await database.admin.connect();
    try {
      const db = drizzle(client, { schema: tables.resourceSchema });
      await db.insert(authUser).values([
        { id: alpha.userId, name: 'Alpha Owner', email: `${alpha.userId}@assets.test` },
        { id: beta.userId, name: 'Beta Owner', email: `${beta.userId}@assets.test` },
        { id: outsider, name: 'Outsider', email: `${outsider}@assets.test` },
      ]);
      await db.insert(tables.knowledgeBase).values([
        { id: alpha.knowledgeBaseId, name: 'Assets Alpha' },
        { id: beta.knowledgeBaseId, name: 'Assets Beta' },
      ]);
      await db.insert(tables.member).values([
        { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.userId, role: 'owner' },
        { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, role: 'owner' },
      ]);
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    for (const object of objects) await storage.deleteObject(object).catch(() => undefined);
    expect(database.idleErrors).toEqual([]);
    await database.dispose();
  });

  test('uploads round trip through a presigned PUT, confirm and presigned GET', async () => {
    const content = file('round-trip');
    register(alpha.knowledgeBaseId, content);
    const request = intent(alpha, content);
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    expect(prepared.action).toBe('upload');
    if (prepared.action !== 'upload') throw new Error('unreachable');
    expect(prepared.method).toBe('PUT');
    expect(prepared.headers['content-type']).toBe(content.mime);
    expect(new URL(prepared.url).pathname).toBe(`/fob-knowledge/${alpha.knowledgeBaseId}/${content.hash}`);
    expect(Date.parse(prepared.expiresAt)).toBeGreaterThan(Date.now());

    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    const jobsBefore = await jobCount(database.admin);
    const confirmed = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));
    expect(confirmed).toEqual({ status: 'ready', created: true });

    const row = await assetRow(database.admin, alpha.knowledgeBaseId, content.hash);
    expect(row).toMatchObject({ status: 'ready', size: String(content.size), mime: content.mime, meta: { name: content.name } });
    await expect(outboxCount(database.admin, 'asset.created', content.hash)).resolves.toBe(1);
    expect(await jobCount(database.admin)).toBe(jobsBefore + 1);

    const grant = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.userId, hash: content.hash }));
    const response = await fetch(grant.url);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content.bytes);
  });

  test('same-knowledgeBase re-probe dedupes (秒传) and re-confirm stays a single event', async () => {
    const content = file('dedupe');
    register(alpha.knowledgeBaseId, content);
    const request = intent(alpha, content);
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));

    expect(await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request))).toEqual({ action: 'reuse' });
    const jobsBefore = await jobCount(database.admin);
    expect(await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request))).toEqual({ status: 'ready', created: false });
    await expect(outboxCount(database.admin, 'asset.created', content.hash)).resolves.toBe(1);
    expect(await jobCount(database.admin)).toBe(jobsBefore);
  });

  test('confirmation mismatches delete the object and leave no rows or events', async () => {
    const wrongHash = file('hash-mismatch');
    register(alpha.knowledgeBaseId, wrongHash);
    const lyingIntent = { ...intent(alpha, wrongHash), hash: createHash('sha256').update(`not ${wrongHash.name}`).digest('hex') };
    register(alpha.knowledgeBaseId, { hash: lyingIntent.hash });
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, lyingIntent));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, wrongHash.mime, wrongHash.bytes)).status).toBe(200);
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, lyingIntent)))
      .rejects.toMatchObject({ code: 'ASSET_HASH_MISMATCH' });
    expect(await storage.statObject({ knowledgeBaseId: alpha.knowledgeBaseId, hash: lyingIntent.hash })).toBeUndefined();
    expect(await assetRow(database.admin, alpha.knowledgeBaseId, lyingIntent.hash)).toBeUndefined();

    const wrongSize = file('size-mismatch');
    register(alpha.knowledgeBaseId, wrongSize);
    const sizeIntent = { ...intent(alpha, wrongSize), size: wrongSize.size + 8 };
    const granted = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, sizeIntent));
    if (granted.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(granted.url, wrongSize.mime, wrongSize.bytes)).status).toBe(200);
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, sizeIntent)))
      .rejects.toMatchObject({ code: 'ASSET_SIZE_MISMATCH' });
    expect(await storage.statObject({ knowledgeBaseId: alpha.knowledgeBaseId, hash: wrongSize.hash })).toBeUndefined();

    const wrongMime = file('mime-mismatch');
    register(alpha.knowledgeBaseId, wrongMime);
    const mimeRequest = intent(alpha, wrongMime);
    const mimeGrant = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, mimeRequest));
    if (mimeGrant.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(mimeGrant.url, 'application/octet-stream', wrongMime.bytes)).status).toBe(200);
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, mimeRequest)))
      .rejects.toMatchObject({ code: 'ASSET_MIME_MISMATCH' });
    expect(await storage.statObject({ knowledgeBaseId: alpha.knowledgeBaseId, hash: wrongMime.hash })).toBeUndefined();

    const ghost = file('never-uploaded');
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, intent(alpha, ghost))))
      .rejects.toMatchObject({ code: 'ASSET_OBJECT_MISSING' });
    expect(await assetRow(database.admin, alpha.knowledgeBaseId, ghost.hash)).toBeUndefined();
    await expect(outboxCount(database.admin, 'asset.created')).resolves.toBe(2);
  });

  test('hash addressing never crosses knowledge bases and outsiders cannot fetch', async () => {
    const shared = file('shared-content');
    const alphaRequest = intent(alpha, shared);
    const alphaUpload = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, alphaRequest));
    if (alphaUpload.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(alphaUpload.url, shared.mime, shared.bytes)).status).toBe(200);
    await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, alphaRequest));
    register(alpha.knowledgeBaseId, shared);

    // Beta's probe must not reveal Alpha's confirmed object: it gets its own upload grant.
    const betaRequest = intent(beta, shared);
    const betaUpload = await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, betaRequest));
    expect(betaUpload.action).toBe('upload');
    if (betaUpload.action !== 'upload') throw new Error('unreachable');
    expect(new URL(betaUpload.url).pathname).toBe(`/fob-knowledge/${beta.knowledgeBaseId}/${shared.hash}`);
    expect((await clientPut(betaUpload.url, shared.mime, shared.bytes)).status).toBe(200);
    expect(await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, betaRequest))).toEqual({ status: 'ready', created: true });
    register(beta.knowledgeBaseId, shared);

    expect(await storage.statObject({ knowledgeBaseId: alpha.knowledgeBaseId, hash: shared.hash })).toBeDefined();
    expect(await storage.statObject({ knowledgeBaseId: beta.knowledgeBaseId, hash: shared.hash })).toBeDefined();
    const betaGrant = await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, hash: shared.hash }));
    expect((await fetch(betaGrant.url)).status).toBe(200);

    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: beta.userId, hash: shared.hash })))
      .rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: outsider, hash: shared.hash })))
      .rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.userId, hash: '0'.repeat(64) })))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, intent(alpha, shared))))
      .resolves.toEqual({ action: 'reuse' });
  });

  test('revocation is soft, refuses downloads and re-uploads, and announces itself', async () => {
    const content = file('revocation');
    register(beta.knowledgeBaseId, content);
    const request = intent(beta, content);
    const prepared = await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));
    const download = (db: Parameters<Parameters<typeof withKnowledgeBase>[2]>[0]) =>
      presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, hash: content.hash });
    await expect(withKnowledgeBase(database.pool, beta.knowledgeBaseId, download)).resolves.toMatchObject({ method: 'GET' });

    expect(await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => revokeKnowledgeBaseAsset(db, { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, hash: content.hash })))
      .toEqual({ status: 'revoked', changed: true });
    expect(await assetRow(database.admin, beta.knowledgeBaseId, content.hash)).toMatchObject({ status: 'revoked' });
    // The object itself is retained (soft revocation), but every grant path is closed.
    expect(await storage.statObject({ knowledgeBaseId: beta.knowledgeBaseId, hash: content.hash })).toMatchObject({ size: content.size });
    await expect(withKnowledgeBase(database.pool, beta.knowledgeBaseId, download)).rejects.toMatchObject({ code: 'ASSET_NOT_READY' });
    await expect(withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request))).rejects.toMatchObject({ code: 'ASSET_NOT_READY' });
    await expect(withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request))).rejects.toMatchObject({ code: 'ASSET_NOT_READY' });
    expect(await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => revokeKnowledgeBaseAsset(db, { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, hash: content.hash })))
      .toEqual({ status: 'revoked', changed: false });

    const announced = (await database.admin.query<{ event: { type: string; hash: string; knowledgeBaseId: string } }>(
      "SELECT payload->'event' AS event FROM resources.outbox WHERE topic='knowledgeBase.event' AND payload->'event'->>'hash'=$1", [content.hash],
    )).rows;
    expect(announced.map((row) => ({ type: row.event.type, hash: row.event.hash, knowledgeBaseId: row.event.knowledgeBaseId })))
      .toEqual([{ type: 'asset.updated', hash: content.hash, knowledgeBaseId: beta.knowledgeBaseId }]);
    await expect(withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => revokeKnowledgeBaseAsset(db, { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.userId, hash: '1'.repeat(64) })))
      .rejects.toMatchObject({ code: 'ASSET_NOT_FOUND' });
  });

  test('presigned grants are method-bound and expire', async () => {
    const content = file('grant-limits');
    register(alpha.knowledgeBaseId, content);
    const request = intent(alpha, content);
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request));
    const grant = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => presignKnowledgeBaseAssetDownload(storage, db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.userId, hash: content.hash }));

    expect((await fetch(grant.url, { method: 'PUT', headers: { 'content-type': content.mime }, body: content.bytes })).status).toBe(403);
    expect((await fetch(prepared.url)).status).toBe(403);
    const expiring = storage.presignDownload({ knowledgeBaseId: alpha.knowledgeBaseId, hash: content.hash }, 1);
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect((await fetch(expiring.url)).status).toBe(403);
  });

  test('a caller abort after confirm rolls the asset, outbox event and job back together', async () => {
    const content = file('atomic-abort');
    register(alpha.knowledgeBaseId, content);
    const request = intent(alpha, content);
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    const jobsBefore = await jobCount(database.admin);

    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, async (db) => {
      await confirmKnowledgeBaseAssetUpload(storage, db, request);
      throw new Error('caller aborts after confirm');
    })).rejects.toThrow('caller aborts after confirm');

    expect(await assetRow(database.admin, alpha.knowledgeBaseId, content.hash)).toBeUndefined();
    await expect(outboxCount(database.admin, 'asset.created', content.hash)).resolves.toBe(0);
    expect(await jobCount(database.admin)).toBe(jobsBefore);
    // The verified object survives, so the client can retry confirmation.
    expect(await storage.statObject({ knowledgeBaseId: alpha.knowledgeBaseId, hash: content.hash })).toMatchObject({ size: content.size });
    expect(await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request))).toEqual({ status: 'ready', created: true });
  });

  test('an enqueue failure inside confirm rolls the asset row and outbox back', async () => {
    const content = file('enqueue-failure');
    const gamma = { knowledgeBaseId: randomUUID(), userId: randomUUID() };
    register(gamma.knowledgeBaseId, content);
    // Schema and RLS are initialized, but the queue schema is deliberately absent.
    const bare = await createResourceTestDatabase();
    try {
      const client = await bare.admin.connect();
      try {
        const db = drizzle(client, { schema: tables.resourceSchema });
        await db.insert(authUser).values({ id: gamma.userId, name: 'Gamma Owner', email: `${gamma.userId}@assets.test` });
        await db.insert(tables.knowledgeBase).values({ id: gamma.knowledgeBaseId, name: 'Assets Gamma' });
        await db.insert(tables.member).values({ knowledgeBaseId: gamma.knowledgeBaseId, userId: gamma.userId, role: 'owner' });
      } finally {
        client.release();
      }
      const request = intent(gamma, content);
      const prepared = await withKnowledgeBase(bare.pool, gamma.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
      if (prepared.action !== 'upload') throw new Error('expected an upload grant');
      expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);

      await expect(withKnowledgeBase(bare.pool, gamma.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, request))).rejects.toThrow();
      expect(await assetRow(bare.admin, gamma.knowledgeBaseId, content.hash)).toBeUndefined();
      expect((await bare.admin.query<{ count: string }>('SELECT count(*)::text FROM resources.outbox')).rows[0]!.count).toBe('0');
      expect(await storage.statObject({ knowledgeBaseId: gamma.knowledgeBaseId, hash: content.hash })).toMatchObject({ size: content.size });
    } finally {
      expect(bare.idleErrors).toEqual([]);
      await bare.dispose();
    }
  });

  test('service errors are structured and membership is required for every path', async () => {
    const content = file('membership');
    register(alpha.knowledgeBaseId, content);
    const request = intent(alpha, content);
    const foreignRequest = { ...request, userId: outsider };
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, foreignRequest)))
      .rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => revokeKnowledgeBaseAsset(db, { knowledgeBaseId: alpha.knowledgeBaseId, userId: outsider, hash: content.hash })))
      .rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    const prepared = await withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => prepareKnowledgeBaseAssetUpload(storage, db, request));
    if (prepared.action !== 'upload') throw new Error('expected an upload grant');
    expect((await clientPut(prepared.url, content.mime, content.bytes)).status).toBe(200);
    await expect(withKnowledgeBase(database.pool, alpha.knowledgeBaseId, (db) => confirmKnowledgeBaseAssetUpload(storage, db, foreignRequest)))
      .rejects.toMatchObject({ code: 'ASSET_ACCESS_DENIED' });
    expect(await assetRow(database.admin, alpha.knowledgeBaseId, content.hash)).toBeUndefined();
  });
});

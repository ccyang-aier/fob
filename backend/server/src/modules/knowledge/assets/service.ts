import { createHash, randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { assetDownloadInputSchema, assetRevokeInputSchema, assetUploadInputSchema } from '@fob/shared/knowledge/contracts';
import type { AssetConfirmResult, AssetDownloadResult, AssetDownloadInput, AssetRevokeInput, AssetRevokeResult, AssetUploadInput, AssetUploadPrepareResult } from '@fob/shared/knowledge/contracts';
import { z } from 'zod';
import { asset, docState, member, page } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { expandRequestPrincipals } from '../permissions/authorization';
import { effectivePageAccessCondition } from '../permissions/queries';
import type { Principal } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { KnowledgeAssetError } from './errors';
import type { KnowledgeAssetStorage } from './storage';
import { recordSubscriptionChange } from '../subscriptions/service';

const uploadGrantSeconds = 600;
const downloadGrantSeconds = 300;

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KnowledgeAssetError('INVALID_ASSET_INPUT');
  return parsed.data;
}

/** Verified members share library assets; document guests need a readable attachment reference. */
async function requireKnowledgeBaseMembership(db: ResourceTransaction, knowledgeBaseId: string, userId: string) {
  const principals = await expandRequestPrincipals(db, knowledgeBaseId, userId);
  if (!principals.length) throw new KnowledgeAssetError('ASSET_ACCESS_DENIED');
  const [membership] = await db.select({ role: member.role }).from(member).where(and(eq(member.knowledgeBaseId, knowledgeBaseId), eq(member.userId, userId)));
  if (!membership) throw new KnowledgeAssetError('ASSET_ACCESS_DENIED');
  return { ...membership, principals };
}

async function requireGuestAssetAccess(db: ResourceTransaction, input: { knowledgeBaseId: string; principals: Principal[]; hash?: string; write?: boolean }) {
  const accessible = effectivePageAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals: input.principals, required: input.write ? 'edit' : 'view' });
  const pages = await db.select({ id: page.id, properties: page.properties }).from(page).where(accessible);
  if (input.write && pages.length) return;
  if (!input.write && input.hash) {
    const address = `asset:${input.hash}`;
    if (pages.some(record => record.properties.fileAsset === address)) return;
    const states = await db.select({ state: docState.state }).from(docState).innerJoin(page, and(eq(page.knowledgeBaseId, docState.knowledgeBaseId), eq(page.id, docState.pageId))).where(accessible);
    for (const state of states) {
      const body = yStateToProseMirrorDoc(state.state, knowledgeSchema);
      let found = false;
      body?.descendants(node => { if (Object.values(node.attrs).includes(address)) found = true; });
      if (found) return;
    }
  }
  throw new KnowledgeAssetError('ASSET_ACCESS_DENIED');
}

const scopedBy = (scope: { knowledgeBaseId: string; hash: string }) => and(eq(asset.knowledgeBaseId, scope.knowledgeBaseId), eq(asset.hash, scope.hash))!;

const normalizeMime = (value: string) => value.split(';', 1)[0]!.trim().toLowerCase();

/**
 * Design §8.1 step 2: probe for an identical hash inside THIS resources.
 * A ready asset is reused (秒传); probing another knowledgeBase is invisible
 * because storage keys and this query are both knowledgeBase-scoped.
 */
export async function prepareKnowledgeBaseAssetUpload(storage: KnowledgeAssetStorage, db: ResourceTransaction, input: AssetUploadInput): Promise<AssetUploadPrepareResult> {
  const parsed = parse(assetUploadInputSchema, input);
  const membership = await requireKnowledgeBaseMembership(db, parsed.knowledgeBaseId, parsed.userId);
  if (membership.role === 'guest') await requireGuestAssetAccess(db, { knowledgeBaseId: parsed.knowledgeBaseId, principals: membership.principals, write: true });
  const [existing] = await db.select({ status: asset.status }).from(asset).where(scopedBy(parsed));
  if (existing?.status === 'ready') return { action: 'reuse' };
  if (existing?.status === 'revoked') throw new KnowledgeAssetError('ASSET_NOT_READY');
  const granted = storage.presignUpload(parsed, uploadGrantSeconds);
  return { action: 'upload', url: granted.url, method: 'PUT', headers: { 'content-type': parsed.mime }, expiresAt: granted.expiresAt };
}

/**
 * Confirms a client's direct upload against the actual stored object: HEAD for
 * size/mime/ETag, then a streamed GET digest. Any mismatch deletes the object
 * under this content-addressed key and fails with a structured error code.
 * The verified row and the asset.created outbox event commit in this one
 * transaction; a concurrent confirm of the same hash stays a single event.
 */
export async function confirmKnowledgeBaseAssetUpload(storage: KnowledgeAssetStorage, db: ResourceTransaction, input: AssetUploadInput): Promise<AssetConfirmResult> {
  const parsed = parse(assetUploadInputSchema, input);
  const membership = await requireKnowledgeBaseMembership(db, parsed.knowledgeBaseId, parsed.userId);
  if (membership.role === 'guest') await requireGuestAssetAccess(db, { knowledgeBaseId: parsed.knowledgeBaseId, principals: membership.principals, write: true });
  const [existing] = await db.select({ status: asset.status }).from(asset).where(scopedBy(parsed));
  if (existing?.status === 'revoked') throw new KnowledgeAssetError('ASSET_NOT_READY');
  if (existing?.status === 'ready') return { status: 'ready', created: false };
  await verifyStoredObject(storage, parsed);
  const inserted = await db.insert(asset).values({
    knowledgeBaseId: parsed.knowledgeBaseId, hash: parsed.hash, mime: parsed.mime, size: parsed.size, meta: { name: parsed.name },
  }).onConflictDoNothing().returning({ hash: asset.hash });
  if (!inserted.length) {
    // Lost a race with a concurrent confirm. A row that became revoked under us still refuses.
    const [winner] = await db.select({ status: asset.status }).from(asset).where(scopedBy(parsed));
    if (winner?.status === 'revoked') throw new KnowledgeAssetError('ASSET_NOT_READY');
    return { status: 'ready', created: false };
  }
  // The confirming member is the attribution target for downstream derivations (§8.2).
  await appendKnowledgeOutbox(db, { knowledgeBaseId: parsed.knowledgeBaseId, topic: 'asset.created', hash: parsed.hash, initiatedBy: parsed.userId });
  return { status: 'ready', created: true };
}

/** HEAD first (fail fast on size/mime), then stream the body once for SHA-256 (and MD5 vs ETag). */
async function verifyStoredObject(storage: KnowledgeAssetStorage, intent: AssetUploadInput) {
  const stat = await storage.statObject(intent);
  if (!stat) throw new KnowledgeAssetError('ASSET_OBJECT_MISSING');
  if (stat.size !== intent.size) return reject(storage, intent, 'ASSET_SIZE_MISMATCH');
  if (normalizeMime(stat.mime) !== intent.mime.toLowerCase()) return reject(storage, intent, 'ASSET_MIME_MISMATCH');
  const response = await storage.openObject(intent);
  const sha256 = createHash('sha256');
  const md5 = createHash('md5');
  const reader = response.body!.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > intent.size) return reject(storage, intent, 'ASSET_SIZE_MISMATCH');
      sha256.update(value);
      md5.update(value);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  if (bytes !== stat.size || bytes !== intent.size) return reject(storage, intent, 'ASSET_SIZE_MISMATCH');
  if (sha256.digest('hex') !== intent.hash) return reject(storage, intent, 'ASSET_HASH_MISMATCH');
  if (/^[a-f0-9]{32}$/.test(stat.etag) && stat.etag !== md5.digest('hex')) return reject(storage, intent, 'ASSET_HASH_MISMATCH');
}

/** The mismatched object is unusable under this content-addressed key for every knowledgeBase path; remove it. */
async function reject(storage: KnowledgeAssetStorage, intent: AssetUploadInput, code: 'ASSET_SIZE_MISMATCH' | 'ASSET_MIME_MISMATCH' | 'ASSET_HASH_MISMATCH'): Promise<never> {
  await storage.deleteObject(intent).catch(() => undefined);
  throw new KnowledgeAssetError(code);
}

/** Confirmed assets remain knowledge-base scoped; guests may read only attachments of accessible pages. */
export async function presignKnowledgeBaseAssetDownload(storage: KnowledgeAssetStorage, db: ResourceTransaction, input: AssetDownloadInput): Promise<AssetDownloadResult> {
  const parsed = parse(assetDownloadInputSchema, input);
  const membership = await requireKnowledgeBaseMembership(db, parsed.knowledgeBaseId, parsed.userId);
  if (membership.role === 'guest') await requireGuestAssetAccess(db, { knowledgeBaseId: parsed.knowledgeBaseId, principals: membership.principals, hash: parsed.hash });
  const [record] = await db.select({ status: asset.status }).from(asset).where(scopedBy(parsed));
  if (!record) throw new KnowledgeAssetError('ASSET_NOT_FOUND');
  if (record.status !== 'ready') throw new KnowledgeAssetError('ASSET_NOT_READY');
  const granted = storage.presignDownload(parsed, downloadGrantSeconds);
  return { url: granted.url, method: 'GET', expiresAt: granted.expiresAt };
}

/** Soft revocation: the object stays in S3, but new download grants and re-uploads of this hash are refused. */
export async function revokeKnowledgeBaseAsset(db: ResourceTransaction, input: AssetRevokeInput): Promise<AssetRevokeResult> {
  const parsed = parse(assetRevokeInputSchema, input);
  const membership = await requireKnowledgeBaseMembership(db, parsed.knowledgeBaseId, parsed.userId);
  if (membership.role === 'guest') throw new KnowledgeAssetError('ASSET_ACCESS_DENIED');
  const predicate = scopedBy(parsed);
  const [record] = await db.select({ status: asset.status }).from(asset).where(predicate).for('update');
  if (!record) throw new KnowledgeAssetError('ASSET_NOT_FOUND');
  if (record.status === 'revoked') return { status: 'revoked', changed: false };
  await db.update(asset).set({ status: 'revoked', updatedAt: new Date() }).where(predicate);
  await appendKnowledgeOutbox(db, {
    knowledgeBaseId: parsed.knowledgeBaseId,
    topic: 'knowledgeBase.event',
    event: { knowledgeBaseId: parsed.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'asset.updated', hash: parsed.hash },
  });
  const files = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), sql`${page.properties}->>'fileAsset' = ${`asset:${parsed.hash}`}`));
  for (const file of files) for (const event of await recordSubscriptionChange(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: file.id, actorId: parsed.userId, change: 'file.changed' })) await appendKnowledgeOutbox(db, event);
  return { status: 'revoked', changed: true };
}

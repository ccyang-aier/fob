import { createHash } from 'node:crypto';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { ModelBinding, PageScope } from '@fob/shared/knowledge/contracts';
import { blockEmbeddingModel, blockEmbeddingStaging, blockIndex } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { ModelGateway } from '../ai/gateway';
import { KnowledgeJobError } from '../workers/types';
import type { KnowledgeConsumer } from '../workers/types';
import { refreshPageBlockIndex } from './indexer';

/** The gateway surface embeddings depend on; production passes the G02-wired ModelGateway. */
export type EmbeddingGateway = Pick<ModelGateway, 'embed'>;

/** Embed-tier bindings must declare dimensions (modelSettingsSchema rule): they are the vector identity. */
export type EmbeddingBinding = ModelBinding & { dimensions: number };

export interface EmbeddingModelTarget {
  readonly model: string;
  readonly dimensions: number;
}

/** Gateway embed accepts at most 512 values and 1 MiB per call; one in-flight batch is the limiter. */
const embedBatchSize = 64;
const embedBatchBytes = 768 * 1024;
/** The gateway rejects a single value beyond this length; such blocks stay unvectorized. */
const embedValueCharLimit = 100_000;
const modelTimeoutMs = 120_000;
const modelMaxRetries = 1;
const stagingBatchSize = 250;
/** Re-staging passes when blocks keep changing under a rebuild; afterwards the entry is retryable. */
const defaultMaxPasses = 3;

export type EmbeddingRebuildErrorCode = 'switch_not_converged';

/** Graphile-safe fixed messages only; the underlying SQL or provider error is never attached. */
export class EmbeddingRebuildError extends Error {
  constructor(readonly code: EmbeddingRebuildErrorCode) {
    super(`Embedding rebuild failed: ${code}`);
    this.name = 'EmbeddingRebuildError';
  }
}

function targetOf(binding: EmbeddingBinding): EmbeddingModelTarget {
  return { model: binding.model, dimensions: binding.dimensions };
}

/** The (embed_model, embed_dimensions) the query side must filter by; null = no vector leg yet (§7.1). */
export async function readActiveEmbeddingModel(db: ResourceTransaction, knowledgeBaseId: string): Promise<EmbeddingModelTarget | null> {
  const [row] = await db.select({ model: blockEmbeddingModel.embedModel, dimensions: blockEmbeddingModel.embedDimensions })
    .from(blockEmbeddingModel).where(eq(blockEmbeddingModel.knowledgeBaseId, knowledgeBaseId));
  return row ? { model: row.model, dimensions: row.dimensions } : null;
}

/**
 * Design §7.1: a very short block carries its title path into the vector as retrieval
 * context. The hash of THIS input — not the bare content hash — is the vector's
 * lineage, so a retitle or heading change re-embeds exactly the affected short blocks.
 */
export function embeddingInput(titlePath: string | null, contentMd: string): string {
  return titlePath ? `${titlePath}\n\n${contentMd}` : contentMd;
}

export function embeddingInputHash(titlePath: string | null, contentMd: string): string {
  return createHash('sha256').update(embeddingInput(titlePath, contentMd), 'utf8').digest('hex');
}

/** The SQL twin of embeddingInputHash over block_index columns (hex text, like the stored hash). */
const inputHashExpression = () => sql`encode(sha256(convert_to(coalesce(${blockIndex.titlePath} || ${'\n\n'}, '') || ${blockIndex.contentMd}, 'UTF8')), 'hex')`;

/** A row's vector is current only when this exact model derived it from this exact embedding input. */
const staleVector = (target: EmbeddingModelTarget) => sql`(${blockIndex.embedding} IS NULL
  OR ${blockIndex.embedModel} IS DISTINCT FROM ${target.model}
  OR ${blockIndex.embedDimensions} IS DISTINCT FROM ${target.dimensions}
  OR ${blockIndex.embeddedHash} IS DISTINCT FROM ${inputHashExpression()})`;

/** A row needs no staging work when staged for the target at the current input hash, or already promoted and consistent. */
const stagedFor = (target: EmbeddingModelTarget) => sql`(EXISTS (
    SELECT 1 FROM ${blockEmbeddingStaging} staging
    WHERE staging.knowledge_base_id = ${blockIndex.knowledgeBaseId} AND staging.page_id = ${blockIndex.pageId}
      AND staging.block_id = ${blockIndex.blockId} AND staging.embed_model = ${target.model}
      AND staging.embed_dimensions = ${target.dimensions} AND staging.content_hash = ${inputHashExpression()})
  OR NOT (${blockIndex.embedModel} IS DISTINCT FROM ${target.model}
    OR ${blockIndex.embedDimensions} IS DISTINCT FROM ${target.dimensions}
    OR ${blockIndex.embeddedHash} IS DISTINCT FROM ${inputHashExpression()}))`;

interface PendingBlock {
  readonly pageId: string;
  readonly blockId: string;
  readonly titlePath: string | null;
  readonly contentHash: string;
  readonly contentMd: string;
}

interface EmbeddedVector {
  readonly row: PendingBlock;
  readonly vector: readonly number[];
}

const utf8Size = (value: string) => Buffer.byteLength(value, 'utf8');

/**
 * Batched, rate-limited embed calls: sequential batches of bounded count and byte
 * size (the gateway validates every value and its dimensions), each committed
 * through the sink as soon as it returns so a later failure resumes cheaply.
 * Failures propagate so Q01's job retry re-enters and skips whatever committed.
 */
async function embedBlocks(gateway: EmbeddingGateway, input: {
  binding: EmbeddingBinding;
  context: { knowledgeBaseId: string; userId: string };
  rows: readonly PendingBlock[];
  sink: (vectors: readonly EmbeddedVector[]) => Promise<void>;
  signal?: AbortSignal;
}): Promise<number> {
  let embedded = 0;
  for (let offset = 0; offset < input.rows.length; ) {
    const batch: PendingBlock[] = [];
    let bytes = 0;
    while (offset < input.rows.length && batch.length < embedBatchSize) {
      const row = input.rows[offset]!;
      const size = utf8Size(row.contentMd);
      if (batch.length && bytes + size > embedBatchBytes) break;
      batch.push(row);
      bytes += size;
      offset += 1;
    }
    input.signal?.throwIfAborted();
    const result = await gateway.embed({
      context: input.context,
      settings: { embed: input.binding },
      values: batch.map((row) => embeddingInput(row.titlePath, row.contentMd)),
      timeoutMs: modelTimeoutMs,
      maxRetries: modelMaxRetries,
      signal: input.signal,
    });
    const vectors = result.embeddings.map((vector, index) => ({ row: batch[index]!, vector }));
    embedded += vectors.length;
    await input.sink(vectors);
  }
  return embedded;
}

/**
 * Compare-and-set into block_index: a row accepts the vector only when its content
 * hash is unchanged AND its vector lineage is still what this run observed (NULL,
 * or already this model). A newer revision or a completed model switch therefore
 * wins without being overwritten, and the queued event for that change converges.
 */
async function storeBlockEmbeddings(pool: Pool, knowledgeBaseId: string, target: EmbeddingModelTarget, vectors: readonly EmbeddedVector[], signal?: AbortSignal): Promise<number> {
  return withKnowledgeBase(pool, knowledgeBaseId, async (db) => {
    let stored = 0;
    for (const { row, vector } of vectors) {
      signal?.throwIfAborted();
      const updated = await db.update(blockIndex).set({
        embedding: [...vector],
        embedModel: target.model,
        embedDimensions: target.dimensions,
        embeddedHash: embeddingInputHash(row.titlePath, row.contentMd),
        updatedAt: sql`clock_timestamp()`,
      }).where(and(
        eq(blockIndex.knowledgeBaseId, knowledgeBaseId),
        eq(blockIndex.pageId, row.pageId),
        eq(blockIndex.blockId, row.blockId),
        eq(blockIndex.contentHash, row.contentHash),
        sql`(${blockIndex.embedding} IS NULL
          OR (${blockIndex.embedModel} = ${target.model} AND ${blockIndex.embedDimensions} = ${target.dimensions}))`,
      )).returning({ id: blockIndex.id });
      stored += updated.length;
    }
    return stored;
  });
}

export interface PageEmbeddingRefresh {
  /** The knowledgeBase's active embedding model during this run; null = no rebuild has completed yet. */
  readonly active: EmbeddingModelTarget | null;
  /** Blocks sent to the embed tier; zero unless the active model matches the binding. */
  readonly embedded: number;
  /** Rows whose compare-and-set accepted the new vectors. */
  readonly stored: number;
  /** Blocks beyond the gateway's per-value limit; they stay keyword-indexed only. */
  readonly skippedOversized: number;
}

/**
 * The doc.changed→index→embed chain for one page (§7.1): H01's differential
 * projection runs first because worker scheduling between same-topic consumers is
 * arbitrary and the projection is idempotent, so this consumer always embeds the
 * event's authoritative content. Only rows stale for the ACTIVE model are sent to
 * the embed tier — unchanged blocks cost zero calls — and model calls stay outside
 * the short transactions.
 */
export async function refreshPageEmbeddings(pool: Pool, options: {
  gateway: EmbeddingGateway;
  binding: EmbeddingBinding;
  scope: PageScope;
  /** Gateway call identity; every actorSchema variant carries the acting user. */
  userId: string;
  signal?: AbortSignal;
}): Promise<PageEmbeddingRefresh> {
  const { gateway, binding, scope, userId, signal } = options;
  signal?.throwIfAborted();
  const planned = await withKnowledgeBase(pool, scope.knowledgeBaseId, async (db) => {
    await refreshPageBlockIndex(db, scope, signal);
    const active = await readActiveEmbeddingModel(db, scope.knowledgeBaseId);
    if (!active || active.model !== binding.model || active.dimensions !== binding.dimensions) {
      // No active model yet, or another model's rebuild is pending: never mix vectors.
      return { active, rows: [] as PendingBlock[] };
    }
    const rows = await db.select({
      pageId: blockIndex.pageId, blockId: blockIndex.blockId, titlePath: blockIndex.titlePath,
      contentHash: blockIndex.contentHash, contentMd: blockIndex.contentMd,
    }).from(blockIndex).where(and(
      eq(blockIndex.knowledgeBaseId, scope.knowledgeBaseId), eq(blockIndex.pageId, scope.pageId), staleVector(active),
    )).orderBy(asc(blockIndex.blockId));
    return { active, rows };
  });
  const embeddable = planned.rows.filter((row) => embeddingInput(row.titlePath, row.contentMd).length <= embedValueCharLimit);
  const active = planned.active;
  if (!active || !embeddable.length) {
    return { active, embedded: 0, stored: 0, skippedOversized: planned.rows.length - embeddable.length };
  }
  let stored = 0;
  const embedded = await embedBlocks(gateway, {
    binding,
    context: { knowledgeBaseId: scope.knowledgeBaseId, userId },
    rows: embeddable,
    signal,
    sink: async (vectors) => { stored += await storeBlockEmbeddings(pool, scope.knowledgeBaseId, active, vectors, signal); },
  });
  return { active, embedded, stored, skippedOversized: planned.rows.length - embeddable.length };
}

export interface BlockEmbeddingConsumerOptions {
  readonly pool: Pool;
  readonly gateway: EmbeddingGateway;
  /** The runtime-resolved embed tier binding (knowledgeBase settings or platform default). */
  readonly binding: EmbeddingBinding;
}

/** H02's doc.changed consumer: keeps the active model's vectors current after H01's projection. */
export function createBlockEmbeddingConsumer(options: BlockEmbeddingConsumerOptions): KnowledgeConsumer {
  const { pool, gateway, binding } = options;
  return {
    name: 'index_embedded_blocks',
    topic: 'doc.changed',
    async handle(event, context) {
      if (event.topic !== 'doc.changed') throw new KnowledgeJobError('invalid_event');
      await refreshPageEmbeddings(pool, {
        gateway, binding,
        scope: { knowledgeBaseId: event.knowledgeBaseId, pageId: event.pageId },
        userId: event.actor.userId,
        signal: context.signal,
      });
    },
  };
}

/** Stage target-model vectors for every block not already staged (or promoted) at its current input hash. */
async function stageKnowledgeBaseVectors(pool: Pool, input: {
  gateway: EmbeddingGateway;
  binding: EmbeddingBinding;
  knowledgeBaseId: string;
  userId: string;
  signal?: AbortSignal;
}): Promise<number> {
  const target = targetOf(input.binding);
  const pending = await withKnowledgeBase(pool, input.knowledgeBaseId, async (db) => db.select({
    pageId: blockIndex.pageId, blockId: blockIndex.blockId, titlePath: blockIndex.titlePath,
    contentHash: blockIndex.contentHash, contentMd: blockIndex.contentMd,
  }).from(blockIndex).where(and(
    eq(blockIndex.knowledgeBaseId, input.knowledgeBaseId),
    sql`NOT ${stagedFor(target)}`,
  )).orderBy(asc(blockIndex.pageId), asc(blockIndex.blockId)));
  const embeddable = pending.filter((row) => embeddingInput(row.titlePath, row.contentMd).length <= embedValueCharLimit);
  if (!embeddable.length) return 0;
  return embedBlocks(input.gateway, {
    binding: input.binding,
    context: { knowledgeBaseId: input.knowledgeBaseId, userId: input.userId },
    rows: embeddable,
    signal: input.signal,
    sink: async (vectors) => {
      for (let offset = 0; offset < vectors.length; offset += stagingBatchSize) {
        await withKnowledgeBase(pool, input.knowledgeBaseId, (db) => db.insert(blockEmbeddingStaging).values(
          vectors.slice(offset, offset + stagingBatchSize).map(({ row, vector }) => ({
            knowledgeBaseId: input.knowledgeBaseId, pageId: row.pageId, blockId: row.blockId,
            embedModel: target.model, embedDimensions: target.dimensions,
            contentHash: embeddingInputHash(row.titlePath, row.contentMd), embedding: [...vector],
          })),
        ).onConflictDoUpdate({
          target: [blockEmbeddingStaging.knowledgeBaseId, blockEmbeddingStaging.pageId, blockEmbeddingStaging.blockId, blockEmbeddingStaging.embedModel, blockEmbeddingStaging.embedDimensions],
          set: { contentHash: sql`excluded.content_hash`, embedding: sql`excluded.embedding`, updatedAt: sql`clock_timestamp()` },
        }));
      }
    },
  });
}

interface EmbeddingSwitchAttempt {
  readonly ready: boolean;
  readonly blocks: number;
  readonly promoted: number;
  readonly missing: number;
}

/**
 * The atomic switch (§12): lock the knowledgeBase's projection rows, promote staged
 * vectors only when they cover EVERY block at its current content hash, then flip
 * the active-model marker and drop staging in the same transaction. Any gap — or
 * any thrown invariant — rolls back completely, leaving the previous model's
 * vectors and marker byte-identical, so the old index keeps serving queries.
 */
async function switchActiveEmbeddingModel(pool: Pool, knowledgeBaseId: string, target: EmbeddingModelTarget, signal?: AbortSignal): Promise<EmbeddingSwitchAttempt> {
  return withKnowledgeBase(pool, knowledgeBaseId, async (db) => {
    signal?.throwIfAborted();
    // Freeze the comparison set; concurrent index writers block until commit or rollback.
    const frozen = await db.select({ id: blockIndex.id }).from(blockIndex)
      .where(eq(blockIndex.knowledgeBaseId, knowledgeBaseId)).for('update');
    const [gap] = await db.select({ missing: sql<number>`count(*)::int` }).from(blockIndex)
      .where(and(eq(blockIndex.knowledgeBaseId, knowledgeBaseId), sql`NOT ${stagedFor(target)}`));
    if ((gap?.missing ?? 0) > 0) return { ready: false, blocks: frozen.length, promoted: 0, missing: gap!.missing };
    // The UPDATE aliases block_index as "block", so the input-hash twin is written for that alias.
    const promoted = await db.execute(sql`update ${blockIndex} as block
      set embedding = staged.embedding, embed_model = staged.embed_model, embed_dimensions = staged.embed_dimensions,
          embedded_hash = staged.content_hash, updated_at = clock_timestamp()
      from ${blockEmbeddingStaging} as staged
      where block.knowledge_base_id = ${knowledgeBaseId}
        and staged.knowledge_base_id = block.knowledge_base_id and staged.page_id = block.page_id and staged.block_id = block.block_id
        and staged.embed_model = ${target.model} and staged.embed_dimensions = ${target.dimensions}
        and staged.content_hash = encode(sha256(convert_to(coalesce(block.title_path || E'\\n\\n', '') || block.content_md, 'UTF8')), 'hex')
      returning block.id`);
    // Belt and braces: the gap check above must leave nothing stale; otherwise roll back.
    const [remaining] = await db.select({ stale: sql<number>`count(*)::int` }).from(blockIndex)
      .where(and(eq(blockIndex.knowledgeBaseId, knowledgeBaseId), staleVector(target)));
    if ((remaining?.stale ?? 0) > 0) throw new EmbeddingRebuildError('switch_not_converged');
    await db.delete(blockEmbeddingStaging).where(eq(blockEmbeddingStaging.knowledgeBaseId, knowledgeBaseId));
    await db.insert(blockEmbeddingModel).values({
      knowledgeBaseId, embedModel: target.model, embedDimensions: target.dimensions, updatedAt: sql`clock_timestamp()`,
    }).onConflictDoUpdate({
      target: blockEmbeddingModel.knowledgeBaseId,
      set: { embedModel: target.model, embedDimensions: target.dimensions, updatedAt: sql`clock_timestamp()` },
    });
    return { ready: true, blocks: frozen.length, promoted: promoted.rowCount ?? 0, missing: 0 };
  });
}

export interface EmbeddingRebuildResult {
  readonly target: EmbeddingModelTarget;
  /** The active model before the run; unchanged when the switch did not complete. */
  readonly activeBefore: EmbeddingModelTarget | null;
  readonly switched: boolean;
  /** Blocks sent to the embed tier across all passes. */
  readonly embedded: number;
  /** Rows promoted into block_index by the switch. */
  readonly promoted: number;
  readonly blocks: number;
}

/**
 * Manual rebuild entry for bootstrap and model generation switches: stage the
 * binding's vectors for the whole knowledgeBase into block_embedding_staging, then
 * atomically promote them and flip the marker. Re-running is cheap and resumable —
 * staged-at-current-hash and already-promoted blocks cost zero calls — and a run
 * that cannot converge (blocks keep changing underneath) fails with the staging
 * kept, ready for the next attempt. The active model's vectors are never touched
 * until the switch commits, so a failed rebuild leaves the old index queryable.
 */
export async function rebuildKnowledgeBaseEmbeddings(pool: Pool, options: {
  gateway: EmbeddingGateway;
  binding: EmbeddingBinding;
  knowledgeBaseId: string;
  userId: string;
  signal?: AbortSignal;
  /** Bound on re-staging passes; the default leaves room for concurrent edits. */
  maxPasses?: number;
}): Promise<EmbeddingRebuildResult> {
  const { gateway, binding, knowledgeBaseId, userId, signal } = options;
  signal?.throwIfAborted();
  const target = targetOf(binding);
  const activeBefore = await withKnowledgeBase(pool, knowledgeBaseId, (db) => readActiveEmbeddingModel(db, knowledgeBaseId));
  let embedded = 0;
  for (let pass = 0; ; pass++) {
    signal?.throwIfAborted();
    embedded += await stageKnowledgeBaseVectors(pool, { gateway, binding, knowledgeBaseId, userId, signal });
    const attempt = await switchActiveEmbeddingModel(pool, knowledgeBaseId, target, signal);
    if (attempt.ready) return { target, activeBefore, switched: true, embedded, promoted: attempt.promoted, blocks: attempt.blocks };
    if (pass + 1 >= (options.maxPasses ?? defaultMaxPasses)) throw new EmbeddingRebuildError('switch_not_converged');
  }
}

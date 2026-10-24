import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import type { ModelBinding, Principal } from '@fob/shared/knowledge/contracts';
import type { HybridSearchHit, HybridSearchResult } from '@fob/shared/knowledge/search';
import { blockIndex } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { ModelGatewayError } from '../ai/gateway';
import type { ModelGateway } from '../ai/gateway';
import { indexedBlockAccessCondition } from '../permissions/queries';
import { embeddingInput, readActiveEmbeddingModel } from './embeddings';
import type { EmbeddingBinding, EmbeddingModelTarget } from './embeddings';
import { searchBlocksByKeyword } from './keyword';

/** The gateway surface hybrid search depends on; production passes the G02-wired ModelGateway. */
export type SearchGateway = Pick<ModelGateway, 'embed' | 'rerank'>;

/** §7.2: each leg contributes its own top 50 before fusion. */
const LEG_LIMIT = 50;
/** RRF constant k: score = Σ 1/(k + rank) over the legs that returned the block. */
const RRF_K = 60;
/** §7.2: the rerank tier only ever sees the fused top 20; the result limit cannot exceed it. */
const RERANK_CANDIDATES = 20;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = RERANK_CANDIDATES;
const MAX_QUERY_LENGTH = 200;
const modelTimeoutMs = 120_000;
const modelMaxRetries = 1;
/** vector's typmod is inlined raw; this bound is the same one modelSettingsSchema enforces. */
const MAX_DIMENSIONS = 16_000;
/**
 * A rerank document is the block's embedding input (title path + content), truncated so
 * 20 candidates stay far below the gateway's 1 MiB shared budget; rerankers gain nothing
 * from more.
 */
const RERANK_DOCUMENT_CHAR_LIMIT = 8_000;
/** Vector-only hits have no term to locate; their snippet is the content head. */
const SNIPPET_WINDOW = 120;
/** AI 方言的块锚点（`{#b:id}`）是索引噪声，摘要中剥除。 */
const blockAnchor = /\s*\{#b:[A-Za-z0-9_-]+\}/g;

export interface HybridSearchInput {
  readonly knowledgeBaseId: string;
  /**
   * 必须来自服务端已验证身份展开的主体集合（与 P03/H03 同一约定），绝不可直接
   * 采用请求体数组。空集合表示无任何授权，返回空结果。
   */
  readonly principals: readonly Principal[];
  /** 空白或超过 200 字符的查询是调用方错误（两腿都无法执行）。 */
  readonly query: string;
  readonly limit?: number;
}

export interface HybridSearchOptions extends HybridSearchInput {
  readonly gateway: SearchGateway;
  /** 运行时解析出的 embed 档绑定；仅当它与知识库当前生效模型一致时向量腿才运行。 */
  readonly embedBinding: EmbeddingBinding;
  /** 知识库 rerank 档绑定；缺省时走网关平台默认，两者皆无则按降级语义跳过重排。 */
  readonly rerankBinding?: ModelBinding;
  /** 网关调用身份；每个 actorSchema 变体都携带发起用户。 */
  readonly userId: string;
  readonly signal?: AbortSignal;
}

interface FusedCandidate {
  readonly pageId: string;
  readonly blockId: string;
  readonly blockType: string;
  /** Merged from whichever leg carries it; the projection keeps both sources identical. */
  titlePath: string | null;
  /** Present once the candidate's full text is known (vector rows carry it; keyword rows are backfilled). */
  contentMd?: string;
  keywordRank?: number;
  keywordScore?: number;
  keywordSnippet?: string;
  vectorRank?: number;
  vectorDistance?: number;
  rrfScore: number;
  rerankScore?: number;
}

const candidateKey = (pageId: string, blockId: string) => `${pageId}:${blockId}`;

/** Deterministic order: RRF score, then the best single-leg rank, then the stable block key. */
function compareCandidates(a: FusedCandidate, b: FusedCandidate): number {
  if (a.rrfScore !== b.rrfScore) return b.rrfScore - a.rrfScore;
  const best = (candidate: FusedCandidate) => Math.min(candidate.keywordRank ?? Number.MAX_SAFE_INTEGER, candidate.vectorRank ?? Number.MAX_SAFE_INTEGER);
  const rankDelta = best(a) - best(b);
  if (rankDelta !== 0) return rankDelta;
  return candidateKey(a.pageId, a.blockId) < candidateKey(b.pageId, b.blockId) ? -1 : 1;
}

function headSnippet(contentMd: string): string {
  const text = contentMd.replace(blockAnchor, '').replace(/\s+/g, ' ').trim();
  return `${text.slice(0, SNIPPET_WINDOW)}${text.length > SNIPPET_WINDOW ? '…' : ''}`;
}

function truncateDocument(value: string): string {
  return value.length > RERANK_DOCUMENT_CHAR_LIMIT ? value.slice(0, RERANK_DOCUMENT_CHAR_LIMIT) : value;
}

interface VectorRow {
  readonly pageId: string;
  readonly blockId: string;
  readonly blockType: string;
  readonly titlePath: string | null;
  readonly contentMd: string;
  readonly distance: number;
}

/**
 * §7.2 向量腿：HNSW 距离序查询，权限谓词（indexedBlockAccessCondition）与当前
 * 模型过滤（embed_model/embed_dimensions，来自 readActiveEmbeddingModel）在同一
 * WHERE 中先于 ORDER BY 与 LIMIT 生效——无权行与旧模型向量既不进结果，也不挤占
 * 有权行的名次。排序表达式 `(embedding::vector(N)) <=> $q` 与按模型表达式 HNSW
 * 索引存储的表达式逐字一致（见文件级说明），索引存在时即被其满足；无索引时同一
 * 表达式退化为精确距离扫描，语义不变。绑定参数的模型谓词在自定义计划中被代入
 * 常量，部分索引可用性不受参数化影响（实测 pgvector 0.8.x）。
 */
async function searchBlocksByVector(db: ResourceTransaction, input: HybridSearchInput & {
  target: EmbeddingModelTarget;
  queryVector: readonly number[];
}): Promise<VectorRow[]> {
  const vectorLiteral = `[${input.queryVector.join(',')}]`;
  // vector's typmod cannot be a bind parameter; the dimension is schema-bounded before inlining.
  const dimensions = sql.raw(String(input.target.dimensions));
  const distance = sql<number>`(${blockIndex.embedding}::vector(${dimensions}) <=> ${vectorLiteral})`;
  return db.select({
    pageId: blockIndex.pageId,
    blockId: blockIndex.blockId,
    blockType: blockIndex.blockType,
    titlePath: blockIndex.titlePath,
    contentMd: blockIndex.contentMd,
    distance,
  }).from(blockIndex)
    .where(and(
      indexedBlockAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals: [...input.principals] }),
      eq(blockIndex.embedModel, input.target.model),
      eq(blockIndex.embedDimensions, input.target.dimensions),
      sql`${blockIndex.embedding} IS NOT NULL`,
    ))
    .orderBy(asc(distance), asc(blockIndex.id))
    .limit(LEG_LIMIT);
}

/** Full text for keyword-only candidates: rerank documents and vector-only snippets need it. */
async function loadCandidateContent(pool: Pool, input: HybridSearchInput, keys: readonly { pageId: string; blockId: string }[]): Promise<Map<string, { titlePath: string | null; contentMd: string }>> {
  const rows = await withKnowledgeBase(pool, input.knowledgeBaseId, (db) => db.select({
    pageId: blockIndex.pageId,
    blockId: blockIndex.blockId,
    titlePath: blockIndex.titlePath,
    contentMd: blockIndex.contentMd,
  }).from(blockIndex).where(and(
    indexedBlockAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals: [...input.principals] }),
    or(...keys.map((key) => and(eq(blockIndex.pageId, key.pageId), eq(blockIndex.blockId, key.blockId)))),
  )));
  return new Map(rows.map((row) => [candidateKey(row.pageId, row.blockId), { titlePath: row.titlePath, contentMd: row.contentMd }]));
}

/**
 * H04 混合检索统一入口（§7.2）：BM25 关键词腿（H03）与 pgvector 向量腿各取前 50，
 * RRF（k=60）融合后取前 20 交 rerank 档精排；搜索框、AI 问答与 MCP search 工具
 * 共用同一结果契约。模型调用（查询向量、重排）都发生在租户事务之外（H02 同款
 * 约定），两腿 SQL 共用一个短事务以取得一致快照。
 *
 * 降级语义：向量腿在无生效模型、embed 绑定与生效模型不一致或查询向量生成失败时
 * 跳过（`vectorLeg` 标注原因），关键词腿不受影响；重排在无绑定/供应商不支持或
 * 调用失败时跳过（`rerank` 标注原因），保持 RRF 序，`rerankScore` 为 null。两条
 * 腿的查询都在权限谓词之内执行。
 *
 * 向量物理索引（按模型表达式 HNSW）是运行期 DDL：`embedding` 列无固定维度，
 * 静态索引不可表达（pgvector 拒绝在无维度列上建 HNSW，实测），且 H02 的原子
 * 切换事务不能容纳 `CREATE INDEX CONCURRENTLY`。唯一正确形态是查询侧拥有的
 * `CREATE INDEX CONCURRENTLY block_index_hnsw_{model}_{dims}_idx ON
 * resources.block_index USING hnsw ((embedding::vector({dims})) vector_cosine_ops)
 * WHERE embed_model = '{model}' AND embed_dimensions = {dims}`——建索引起点是
 * 持有管理 DDL 权限的部署/维护通道（与 knowledge-db init/check 同级，不进 schema
 * 源与初始化事务，应用角色无 DDL 授权），在 H02 切换提交后为生效模型创建。
 */
export async function searchHybrid(pool: Pool, options: HybridSearchOptions): Promise<HybridSearchResult> {
  if (typeof options.query !== 'string') throw new TypeError('Invalid hybrid search query');
  const query = options.query.trim();
  if (!query || query.length > MAX_QUERY_LENGTH) throw new TypeError('Invalid hybrid search query');
  const limit = options.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw new TypeError('Invalid hybrid search limit');

  const { gateway } = options;
  const base = { knowledgeBaseId: options.knowledgeBaseId, principals: options.principals, query };

  // Stage 1: which model owns this knowledgeBase's vectors (§7.1 filter source).
  const active = await withKnowledgeBase(pool, options.knowledgeBaseId, (db) => readActiveEmbeddingModel(db, options.knowledgeBaseId));

  // Stage 2: the query vector, generated outside any transaction by the ACTIVE model only.
  type VectorLeg = HybridSearchResult['vectorLeg'];
  let vectorLeg: VectorLeg;
  let queryVector: readonly number[] | null = null;
  if (!active) {
    vectorLeg = { status: 'skipped', reason: 'no_active_model' };
  } else if (!Number.isInteger(active.dimensions) || active.dimensions < 1 || active.dimensions > MAX_DIMENSIONS) {
    throw new TypeError('Invalid active embedding dimensions');
  } else if (active.model !== options.embedBinding.model || active.dimensions !== options.embedBinding.dimensions) {
    // Never compare vectors from two models: query-side twin of H02's no-mixing rule.
    vectorLeg = { status: 'skipped', reason: 'binding_mismatch' };
  } else {
    try {
      const embedded = await gateway.embed({
        context: { knowledgeBaseId: options.knowledgeBaseId, userId: options.userId },
        settings: { embed: options.embedBinding },
        values: [query],
        timeoutMs: modelTimeoutMs,
        maxRetries: modelMaxRetries,
        signal: options.signal,
      });
      queryVector = embedded.embeddings[0]!;
      vectorLeg = { status: 'used', model: active.model, dimensions: active.dimensions };
    } catch (error) {
      if (!(error instanceof ModelGatewayError)) throw error;
      if (error.code === 'cancelled') throw error;
      vectorLeg = { status: 'skipped', reason: 'embed_unavailable' };
    }
  }

  // Stage 3: both legs share one resource transaction (consistent snapshot), each inside the
  // access predicate, each capped at 50 (§7.2).
  const { keywordHits, vectorRows } = await withKnowledgeBase(pool, options.knowledgeBaseId, async (db) => {
    const keywordHits = await searchBlocksByKeyword(db, { ...base, limit: LEG_LIMIT });
    const vectorRows = queryVector && active ? await searchBlocksByVector(db, { ...base, target: active, queryVector }) : [];
    return { keywordHits, vectorRows };
  });

  // Stage 4: RRF fusion — Σ 1/(60 + rank) over the legs that returned the block.
  const fused = new Map<string, FusedCandidate>();
  keywordHits.forEach((hit, index) => {
    const rank = index + 1;
    const key = candidateKey(hit.pageId, hit.blockId);
    const candidate = fused.get(key) ?? { pageId: hit.pageId, blockId: hit.blockId, blockType: hit.blockType, titlePath: hit.titlePath, rrfScore: 0 };
    candidate.keywordRank = rank;
    candidate.keywordScore = hit.score;
    candidate.keywordSnippet = hit.snippet;
    candidate.rrfScore += 1 / (RRF_K + rank);
    fused.set(key, candidate);
  });
  vectorRows.forEach((row, index) => {
    const rank = index + 1;
    const key = candidateKey(row.pageId, row.blockId);
    const candidate = fused.get(key) ?? { pageId: row.pageId, blockId: row.blockId, blockType: row.blockType, titlePath: row.titlePath, rrfScore: 0 };
    candidate.vectorRank = rank;
    candidate.vectorDistance = row.distance;
    candidate.contentMd = row.contentMd;
    candidate.titlePath = row.titlePath;
    candidate.rrfScore += 1 / (RRF_K + rank);
    fused.set(key, candidate);
  });
  const ranked = [...fused.values()].sort(compareCandidates);
  const candidates = ranked.slice(0, RERANK_CANDIDATES);

  // Keyword rows carry only snippets; backfill full text (inside the predicate) for rerank.
  const missing = candidates.filter((candidate) => candidate.contentMd === undefined);
  if (missing.length) {
    const loaded = await loadCandidateContent(pool, base, missing.map((candidate) => ({ pageId: candidate.pageId, blockId: candidate.blockId })));
    for (const candidate of missing) {
      const row = loaded.get(candidateKey(candidate.pageId, candidate.blockId));
      if (!row) continue; // Vanished or lost access between transactions: honestly dropped.
      candidate.contentMd = row.contentMd;
      candidate.titlePath ??= row.titlePath;
    }
  }
  const rerankable = candidates.filter((candidate) => candidate.contentMd !== undefined);

  // Stage 5: rerank the fused top 20 (§7.2), or degrade to the RRF order with a reason.
  let ordered = rerankable;
  let rerank: HybridSearchResult['rerank'];
  if (!rerankable.length) {
    rerank = { status: 'skipped', reason: 'no_candidates' };
  } else {
    try {
      const { ranking } = await gateway.rerank({
        context: { knowledgeBaseId: options.knowledgeBaseId, userId: options.userId },
        settings: options.rerankBinding ? { rerank: options.rerankBinding } : {},
        query,
        documents: rerankable.map((candidate) => truncateDocument(embeddingInput(candidate.titlePath ?? null, candidate.contentMd!))),
        topN: rerankable.length,
        timeoutMs: modelTimeoutMs,
        maxRetries: modelMaxRetries,
        signal: options.signal,
      });
      // Providers may return a subset of topN; unranked candidates keep the RRF order
      // after the ranked ones, with rerankScore null.
      const byScore = [...ranking].sort((a, b) => b.score - a.score || a.originalIndex - b.originalIndex);
      for (const row of byScore) rerankable[row.originalIndex]!.rerankScore = row.score;
      const rankedIndexes = new Set(byScore.map((row) => row.originalIndex));
      ordered = [
        ...byScore.map((row) => rerankable[row.originalIndex]!),
        ...rerankable.filter((_, index) => !rankedIndexes.has(index)),
      ];
      rerank = { status: 'applied' };
    } catch (error) {
      if (!(error instanceof ModelGatewayError)) throw error;
      if (error.code === 'cancelled') throw error;
      ordered = rerankable;
      rerank = { status: 'skipped', reason: error.code === 'configuration' || error.code === 'unsupported_capability' || error.code === 'credential_unavailable' ? 'not_configured' : 'provider_failed' };
    }
  }

  const hits: HybridSearchHit[] = ordered.slice(0, limit).map((candidate) => ({
    pageId: candidate.pageId,
    blockId: candidate.blockId,
    blockType: candidate.blockType,
    titlePath: candidate.titlePath,
    snippet: candidate.keywordSnippet ?? headSnippet(candidate.contentMd!),
    sources: [
      ...(candidate.keywordRank !== undefined ? ['keyword' as const] : []),
      ...(candidate.vectorRank !== undefined ? ['vector' as const] : []),
    ],
    keywordScore: candidate.keywordScore ?? null,
    semanticScore: candidate.vectorDistance !== undefined ? 1 - candidate.vectorDistance : null,
    rrfScore: candidate.rrfScore,
    rerankScore: candidate.rerankScore ?? null,
  }));
  return { hits, vectorLeg, rerank };
}

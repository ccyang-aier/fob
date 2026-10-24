import { z } from 'zod';
import { blockIdSchema, entityIdSchema } from '../contracts';

/**
 * H03 关键词检索的单个可引用块结果（§7.2 混合检索的 BM25 腿）。搜索框、AI 问答
 * 与 MCP search 工具共用同一结构；score 是未归一的 BM25 得分，仅供 RRF 融合与
 * 排序使用，不对用户展示。
 */
export const keywordSearchHitSchema = z.strictObject({
  pageId: entityIdSchema,
  blockId: blockIdSchema,
  blockType: z.string().min(1).max(60),
  /** 短块的标题路径呈现上下文；长块没有（§7.1）。 */
  titlePath: z.string().nullable(),
  /** 命中词附近的正文摘要片段（已去除 AI 方言锚点）。 */
  snippet: z.string(),
  score: z.number(),
});

export type KeywordSearchHit = z.infer<typeof keywordSearchHitSchema>;

/** Which hybrid leg (§7.2) surfaced a block: the BM25 keyword leg and/or the vector leg. */
export const hybridSearchSourceSchema = z.enum(['keyword', 'vector']);

/**
 * H04 混合检索单个可引用块结果：搜索框、AI 问答与 MCP search 工具共用的统一契约。
 * 基于 KeywordSearchHit 扩展——`score`（未归一 BM25）拆为各腿得分并补充融合与精排
 * 信息：`keywordScore`/`semanticScore` 为 null 表示该腿未命中；`rrfScore` 是
 * Σ 1/(60 + rank)（rank 按腿内名次，1 起）；`rerankScore` 为 null 表示重排未覆盖
 * （重排跳过或模型未返回该块），此时排序退回 RRF 序。
 */
export const hybridSearchHitSchema = keywordSearchHitSchema.omit({ score: true }).extend({
  sources: z.array(hybridSearchSourceSchema).min(1),
  keywordScore: z.number().nullable(),
  /** 1 − 余弦距离，仅向量腿命中时存在；与模型绑定，不对用户展示。 */
  semanticScore: z.number().nullable(),
  rrfScore: z.number(),
  rerankScore: z.number().nullable(),
});

export type HybridSearchHit = z.infer<typeof hybridSearchHitSchema>;

/** Why the vector leg did not run; 'used' reports the model its vectors were filtered by. */
export const hybridVectorLegSchema = z.union([
  z.strictObject({ status: z.literal('used'), model: z.string().min(1), dimensions: z.number().int().min(1) }),
  z.strictObject({ status: z.literal('skipped'), reason: z.enum(['no_active_model', 'binding_mismatch', 'embed_unavailable']) }),
]);

/**
 * Rerank outcome. `skipped` keeps the RRF order: `no_candidates` = 融合结果为空；
 * `not_configured` = rerank 档无绑定或供应商不支持；`provider_failed` = 调用失败
 * （鉴权/限流/超时/响应非法），检索仍以 RRF 序返回，调用方可据 reason 提示。
 */
export const hybridRerankStateSchema = z.strictObject({
  status: z.enum(['applied', 'skipped']),
  reason: z.enum(['no_candidates', 'not_configured', 'provider_failed']).optional(),
});

/** The single hybrid retrieval entry's result: hits plus per-stage state. */
export const hybridSearchResultSchema = z.strictObject({
  hits: z.array(hybridSearchHitSchema),
  vectorLeg: hybridVectorLegSchema,
  rerank: hybridRerankStateSchema,
});

export type HybridSearchResult = z.infer<typeof hybridSearchResultSchema>;

import { parse } from 'node-html-parser';
import { z } from 'zod';
import type { ModelCatalogEntry, ModelRating } from '@fob/shared/model-catalog';

type Rating = ModelRating;
export type RatingEvidence = Partial<Record<keyof ModelCatalogEntry['ratings'], Rating | null>>;
const round = (value: number) => Math.round(value * 10) / 10;
const finite = z.number().finite();
const analysisRecord = z.object({
  slug: z.string(), name: z.string(),
  intelligenceIndex: finite.min(0).max(100).nullable(),
  intelligenceIndexIsEstimated: z.boolean(),
  analystAgent: finite.min(0).max(1).nullable(),
  medianOutputTokensPerSecond: finite.nonnegative().nullable(),
});
const designBoard = z.object({ modelStats: z.array(z.object({ model: z.string(), elo: finite })) });

/** Explicit identities prevent silently substituting a different generation or reasoning variant. */
export const ratingIdentities: Record<string, { analysis: string; design?: string; writing?: string }> = {
  'gpt-6.1-sol': { analysis: 'gpt-6-1-sol', design: 'gpt-6.1-sol', writing: 'gpt-6.1-sol-max' },
  'gpt-6-luna': { analysis: 'gpt-6-luna', design: 'gpt-6-luna', writing: 'gpt-6-luna-max' },
  'claude-haiku-5-5': { analysis: 'claude-haiku-5-5', design: 'claude-haiku-5-5' },
  'claude-sonnet-5-5': { analysis: 'claude-sonnet-5-5', design: 'claude-sonnet-5-5', writing: 'claude-sonnet-5.5-xhigh' },
  'claude-haiku-4-5-20251001': { analysis: 'claude-4-5-haiku-reasoning', design: 'claude-haiku-4-5', writing: 'claude-haiku-4-5-20251001' },
  'deepseek-flash': { analysis: 'deepseek-v4-1-flash', design: 'deepseek-v4-1-flash', writing: 'deepseek-v4.1-flash-max' },
};

/** Read public Next.js response data as JSON only; never execute source-page scripts. */
export function readPageObjects(html: string): Record<string, unknown>[] {
  const chunks = [...html.matchAll(/self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g)]
    .map(match => JSON.parse(match[1]!) as string).join('');
  const objects: Record<string, unknown>[] = [];
  function visit(value: unknown) {
    if (!value || typeof value !== 'object') return;
    if (!Array.isArray(value)) objects.push(value as Record<string, unknown>);
    for (const child of Object.values(value)) visit(child);
  }
  for (const record of chunks.split('\n')) {
    const json = record.slice(record.indexOf(':') + 1);
    try { visit(JSON.parse(json)); } catch { /* Flight module/text records are not JSON data. */ }
  }
  return objects;
}

function rating(score: number, label: string, url: string, zh: string, en: string): Rating {
  return { kind: 'measured', score: round(score), source: { label, url }, note: { zh, en } };
}

/** Elo is converted to a win probability against a fixed 1200 reference, not an accuracy %. */
export function preferenceRating(elo: number) {
  if (!Number.isFinite(elo)) throw new Error('Preference rating must be finite.');
  return round(100 / (1 + 10 ** ((1200 - elo) / 400)));
}

export function readAnalysisRatings(html: string, observedAt: string): Map<string, RatingEvidence> {
  const ratings = new Map<string, RatingEvidence>();
  for (const object of readPageObjects(html)) {
    const result = analysisRecord.safeParse(object);
    if (!result.success) continue;
    const row = result.data;
    const url = `https://artificialanalysis.ai/models/${row.slug}`;
    const suffix = ` ${row.name}; ${observedAt}.`;
    const fields: RatingEvidence = {
      intelligence: row.intelligenceIndex === null || row.intelligenceIndexIsEstimated ? null : rating(
        row.intelligenceIndex, 'Artificial Analysis', url,
        `AA 智能指数，沿用原始 0–100 分；测量配置：${row.name}；采集 ${observedAt}。`,
        `Original AA Intelligence Index on its 0–100 scale.${suffix}`),
      agentic: row.analystAgent === null ? null : rating(
        row.analystAgent * 100, 'Artificial Analysis · AnalystAgent', url,
        `AA-AnalystAgent 代理数据分析任务成功率 ×100；仅代表此任务集，非通用 Agent 总分；配置：${row.name}；采集 ${observedAt}。`,
        `AA-AnalystAgent success rate ×100. A proxy for agentic data analysis, not a universal agent score.${suffix}`),
      speed: row.medianOutputTokensPerSecond === null ? null : rating(
        100 * row.medianOutputTokensPerSecond / (row.medianOutputTokensPerSecond + 100), 'Artificial Analysis', url,
        `AA 输出中位速度 ${round(row.medianOutputTokensPerSecond)} tokens/s；评分 = 100×速度/(速度+100)，不含首字等待；配置：${row.name}；采集 ${observedAt}。`,
        `AA median output ${round(row.medianOutputTokensPerSecond)} tokens/s. Score = 100×speed/(speed+100); excludes first-token latency.${suffix}`),
    };
    ratings.set(row.slug, fields);
  }
  if (!ratings.size) throw new Error('Artificial Analysis page contains no recognized model data.');
  return ratings;
}

/** The documented free API exposes intelligence and speed, not an Agentic composite. */
export function readAnalysisApiRatings(payload: unknown, observedAt: string): Map<string, RatingEvidence> {
  const response = z.object({ data: z.array(z.object({
    slug: z.string(), name: z.string(),
    evaluations: z.object({ artificial_analysis_intelligence_index: finite.min(0).max(100).nullable() }),
    median_output_tokens_per_second: finite.nonnegative().nullable(),
  })) }).parse(payload);
  return new Map(response.data.map(row => {
    const url = `https://artificialanalysis.ai/models/${row.slug}`;
    return [row.slug, {
      intelligence: row.evaluations.artificial_analysis_intelligence_index === null ? null : rating(
        row.evaluations.artificial_analysis_intelligence_index, 'Artificial Analysis', url,
        `AA API 智能指数，沿用原始 0–100 分；配置：${row.name}；采集 ${observedAt}。`,
        `Original AA API Intelligence Index on its 0–100 scale. ${row.name}; observed ${observedAt}.`),
      speed: row.median_output_tokens_per_second === null ? null : rating(
        100 * row.median_output_tokens_per_second / (row.median_output_tokens_per_second + 100), 'Artificial Analysis', url,
        `AA API 输出中位速度 ${round(row.median_output_tokens_per_second)} tokens/s；评分 = 100×速度/(速度+100)，不含首字等待；配置：${row.name}；采集 ${observedAt}。`,
        `AA API median output ${round(row.median_output_tokens_per_second)} tokens/s. Score = 100×speed/(speed+100); excludes first-token latency. ${row.name}; observed ${observedAt}.`),
    }];
  }));
}

export function readDesignRatings(html: string, observedAt: string): Map<string, Rating> {
  const objects = readPageObjects(html);
  const boards = objects.find(object => object.initialBoards)?.initialBoards;
  const result = designBoard.safeParse((boards as Record<string, unknown> | undefined)?.allcategories);
  if (!result.success) throw new Error('DesignArena page contains no recognized frontend leaderboard.');
  return new Map(result.data.modelStats.map(row => [row.model, rating(
    preferenceRating(row.elo), 'DesignArena · Frontend', 'https://www.designarena.ai/leaderboard',
    `前端设计偏好 Elo ${row.elo}；换算为对固定 1200 Elo 参考的胜率：100/(1+10^((1200−Elo)/400))；非设计准确率；采集 ${observedAt}。`,
    `Frontend design preference Elo ${row.elo}. Score = win probability vs fixed 1200 Elo: 100/(1+10^((1200−Elo)/400)); not design accuracy. Observed ${observedAt}.`)]));
}

export function readWritingRatings(html: string, observedAt: string): Map<string, Rating> {
  const rows = parse(html).querySelectorAll('tr');
  const ratings = new Map<string, Rating>();
  for (const row of rows) {
    const cells = row.querySelectorAll('td');
    const model = cells[2]?.querySelector('a')?.textContent.trim();
    const value = cells[3]?.textContent.match(/^\s*(\d{3,4})(?:[±\s]|$)/)?.[1];
    if (!model || !value) continue;
    const elo = Number(value);
    ratings.set(model, rating(preferenceRating(elo), 'Arena · Creative Writing', 'https://arena.ai/leaderboard/chat/text/creative-writing',
      `创意写作偏好 Elo ${elo}；对固定 1200 Elo 参考的胜率：100/(1+10^((1200−Elo)/400))；榜单配置 ${model}，非写作准确率；采集 ${observedAt}。`,
      `Creative-writing preference Elo ${elo}; win probability vs fixed 1200 Elo: 100/(1+10^((1200−Elo)/400)). Tested as ${model}; not writing accuracy. Observed ${observedAt}.`));
  }
  if (!ratings.size) throw new Error('Arena page contains no recognized creative-writing table.');
  return ratings;
}

/** Image quality, seconds/image and USD/image remain explicitly separate from text measurements. */
export function readImageRatings(html: string, observedAt: string): Map<string, RatingEvidence> {
  const record = z.object({
    model: z.object({ slug: z.string(), qualityElo: finite.nullable() }),
    host: z.object({ name: z.string() }),
    isRepresentative: z.literal(true),
    pricePer1kImages: finite.nonnegative().nullable(),
    performance: z.object({ medianGenerationTimeSeconds: finite.positive().nullable() }).nullable(),
  });
  const ratings = new Map<string, RatingEvidence>();
  for (const object of readPageObjects(html)) {
    const parsed = record.safeParse(object);
    if (!parsed.success) continue;
    const row = parsed.data;
    const url = `https://artificialanalysis.ai/image/models/${row.model.slug}`;
    const seconds = row.performance?.medianGenerationTimeSeconds;
    ratings.set(row.model.slug, {
      design: row.model.qualityElo === null ? null : rating(preferenceRating(row.model.qualityElo), 'Artificial Analysis · Image Arena', url,
        `生图质量偏好 Elo ${row.model.qualityElo}；对固定 1200 Elo 参考的胜率：100/(1+10^((1200−Elo)/400))；仅代表图像偏好，非文本智能指数或前端设计能力；采集 ${observedAt}。`,
        `Image-generation preference Elo ${row.model.qualityElo}; win probability vs fixed 1200 Elo: 100/(1+10^((1200−Elo)/400)). Image preference only, not text intelligence or frontend design. Observed ${observedAt}.`),
      speed: !seconds ? null : rating(1000 / (10 + seconds), 'Artificial Analysis · Image Generation', url,
        `${row.host.name} 生图中位耗时 ${round(seconds)} 秒/图；评分=100×10/(10+秒数)，10秒基准；与文本 tokens/s 分属不同口径；采集 ${observedAt}。`,
        `${row.host.name} median image-generation time ${round(seconds)} seconds/image. Score = 100×10/(10+seconds), a 10-second reference. Separate from text tokens/s. Observed ${observedAt}.`),
      price: row.pricePer1kImages === null ? null : rating(100 / (1 + row.pricePer1kImages / 50), 'Artificial Analysis · Image Price', url,
        `${row.host.name} 生图价 $${row.pricePer1kImages}/1000图；评分=100/(1+每图USD/0.05)，$0.05/图基准；非文本 token 价格；采集 ${observedAt}。`,
        `${row.host.name} image-generation price $${row.pricePer1kImages}/1000 images. Score = 100/(1+USD-per-image/0.05), a $0.05/image reference. Not text-token pricing. Observed ${observedAt}.`),
    });
  }
  if (!ratings.size) throw new Error('Artificial Analysis image page contains no recognized representative model data.');
  return ratings;
}

/** Missing source observations cannot erase a rating; measured data always supersedes mock seeds. */
export function mergeRatingEvidence(model: ModelCatalogEntry, evidence: RatingEvidence) {
  for (const axis of ['intelligence', 'agentic', 'writing', 'design', 'speed', 'price'] as const) {
    if (axis === 'agentic' && model.capabilities.tools === false) {
      model.ratings.agentic = null;
      continue;
    }
    const incoming = evidence[axis];
    if (incoming && (incoming.kind === 'measured' || model.ratings[axis]?.kind !== 'measured')) {
      model.ratings[axis] = incoming;
    }
  }
}

export function priceRating(model: ModelCatalogEntry, observedAt: string): Rating | null {
  const { input, output } = model.pricing;
  // A token-only estimate would misrepresent models that also charge per generated image/video.
  if (input === null || output === null || model.capabilities.imageGeneration || model.capabilities.videoGeneration) return null;
  const blended = (3 * input + output) / 4;
  return rating(100 / (1 + blended), 'Provider list price', model.sources[0]!.url,
    `标准文本价，3:1 输入/输出混合 $${round(blended)}/百万 tokens；越便宜分越高：100/(1+混合价)，不含缓存、折扣和工具费；目录核验 ${model.verifiedAt}，计算 ${observedAt}。`,
    `Standard text list price with 3:1 input/output blend: $${round(blended)}/1M tokens. Cheaper scores higher: 100/(1+blended price). Excludes cache, discounts and tools. Price verified ${model.verifiedAt}; computed ${observedAt}.`);
}

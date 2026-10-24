import { and, or, asc, desc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { Principal } from '@fob/shared/knowledge/contracts';
import type { KeywordSearchHit } from '@fob/shared/knowledge/search';
import { blockIndex } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { indexedBlockAccessCondition } from '../permissions/queries';

/** 参与检索的词数上限：约束 SQL 谓词数量与查询膨胀。 */
const MAX_QUERY_TERMS = 8;
const MAX_QUERY_LENGTH = 200;
const DEFAULT_LIMIT = 20;
/** §7.2 混合检索的 BM25 腿取前 50，H05 的 RRF 融合同此上限。 */
const MAX_LIMIT = 50;
/** 摘要片段的目标长度（字符）。 */
const SNIPPET_WINDOW = 120;
/**
 * 纯 ASCII 词达到该长度才做前缀扩展（deploy → deployment，即词干式英文召回，
 * §7.3）：更短的词前缀噪声过大。中文词按 jieba 精确切分，不做前缀。
 */
const PREFIX_MIN_TERM_LENGTH = 3;
/** pg_search 前缀扩展的候选词上限。 */
const PREFIX_MAX_EXPANSION = 10;

const edgePunctuation = /^[.,;:!?()[\]{}'"<>,]+|[.,;:!?()[\]{}'"<>,]+$/g;
const asciiWord = /^[A-Za-z0-9][A-Za-z0-9+#._-]*$/;
/** AI 方言的块锚点（`{#b:id}`）是索引噪声，摘要中剥除。 */
const blockAnchor = /\s*\{#b:[A-Za-z0-9_-]+\}/g;

interface KeywordTerms {
  /** 走 `@@@` 字符串查询的精确词（中文/混合词与短 ASCII 词）。 */
  readonly exact: readonly string[];
  /** 走 phrase_prefix 前缀扩展的 ASCII 词。 */
  readonly prefixes: readonly string[];
}

/**
 * 把检索框输入拆成词并分类。pg_search 0.25 的查询字符串语法不支持通配符，
 * 且 `match(prefix)` 对多词/单词行为不一致（实测 0.25.10），因此可依赖的语义是：
 * `@@@ 'q1 q2'`（jieba 切分、大小写归一、默认析取）+ 每个英文词一个
 * `pdb.phrase_prefix` 谓词按 OR 组合。实测两者与 paradedb.score 组合行为确定。
 */
function parseKeywordTerms(query: string): KeywordTerms {
  const exact: string[] = [];
  const prefixes: string[] = [];
  for (const raw of query.split(/\s+/)) {
    const term = raw.replace(edgePunctuation, '');
    if (!term) continue;
    (asciiWord.test(term) && term.length >= PREFIX_MIN_TERM_LENGTH ? prefixes : exact).push(term);
    if (exact.length + prefixes.length >= MAX_QUERY_TERMS) break;
  }
  return { exact, prefixes };
}

/** 命中词附近的正文窗口；找不到字面命中（如前缀跨形态）时取开头。 */
function excerptOf(contentMd: string, terms: readonly string[]): string {
  const text = contentMd.replace(blockAnchor, '').replace(/\s+/g, ' ').trim();
  let at = 0;
  for (const term of terms) {
    const found = text.toLowerCase().indexOf(term.toLowerCase());
    if (found >= 0) { at = found; break; }
  }
  const start = Math.max(0, at - Math.floor(SNIPPET_WINDOW / 3));
  const end = Math.min(text.length, start + SNIPPET_WINDOW);
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}${end < text.length ? '…' : ''}`;
}

export interface KeywordSearchInput {
  readonly knowledgeBaseId: string;
  /**
   * 必须来自服务端已验证身份展开的主体集合（与 P03 同一约定），绝不可直接
   * 采用请求体数组。空集合表示无任何授权，返回空结果。
   */
  readonly principals: readonly Principal[];
  readonly query: string;
  readonly limit?: number;
  readonly offset?: number;
}

/**
 * H03 关键词检索：block_index 上真实的 pg_search BM25 查询（jieba 中英文混合
 * 切分）。权限谓词（knowledgeBase + principals + 回收页 + ACL 版本守卫，来自
 * indexedBlockAccessCondition）与命中谓词在同一 WHERE 中先于 ORDER BY score 与
 * LIMIT 生效——无权行既不进结果，也不挤占有权行的名次（§7.2）。结果携带
 * pageId/blockId/titlePath/摘要片段与 BM25 得分，供 H05 融合与 AI 引用。
 */
export async function searchBlocksByKeyword(db: ResourceTransaction, input: KeywordSearchInput): Promise<KeywordSearchHit[]> {
  if (typeof input.query !== 'string') throw new TypeError('Invalid keyword search query');
  const query = input.query.trim();
  if (query.length > MAX_QUERY_LENGTH) throw new TypeError('Invalid keyword search query');
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT || !Number.isInteger(offset) || offset < 0) {
    throw new TypeError('Invalid keyword search pagination');
  }
  const terms = parseKeywordTerms(query);
  if (!terms.exact.length && !terms.prefixes.length) return [];

  const predicates: SQL[] = [];
  if (terms.exact.length) predicates.push(sql`${blockIndex.contentMd} @@@ ${terms.exact.join(' ')}`);
  for (const term of terms.prefixes) {
    predicates.push(sql`${blockIndex.contentMd} @@@ pdb.phrase_prefix(${sql.param([term])}::text[], ${PREFIX_MAX_EXPANSION})`);
  }
  // 命中谓词之间是析取（任一语言腿命中即入选），与权限谓词再合取。
  const matches = predicates.length === 1 ? predicates[0]! : or(...predicates)!;
  const rows = await db.select({
    pageId: blockIndex.pageId,
    blockId: blockIndex.blockId,
    blockType: blockIndex.blockType,
    titlePath: blockIndex.titlePath,
    contentMd: blockIndex.contentMd,
    score: sql<number>`paradedb.score(${blockIndex.id})`,
  }).from(blockIndex)
    .where(and(indexedBlockAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals: [...input.principals] }), matches))
    .orderBy(desc(sql`paradedb.score(${blockIndex.id})`), asc(blockIndex.id))
    .limit(limit).offset(offset);

  const highlights = [...terms.exact, ...terms.prefixes];
  return rows.map((row) => ({
    pageId: row.pageId,
    blockId: row.blockId,
    blockType: row.blockType,
    titlePath: row.titlePath,
    snippet: excerptOf(row.contentMd, highlights),
    score: row.score,
  }));
}

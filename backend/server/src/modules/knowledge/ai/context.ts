import { and, eq, or } from 'drizzle-orm';
import type { Pool } from 'pg';
import * as Y from 'yjs';
import {
  blockIdSchema,
  contextHistoryMessageSchema,
  contextTaskKindSchema,
  entityIdSchema,
} from '@fob/shared/knowledge/contracts';
import type {
  ContextHistoryMessage,
  ContextNeighborBlock,
  ContextOutlineEntry,
  ContextRetrievalItem,
  ContextSegment,
  ContextTaskKind,
  ContextUsage,
  AssembledContext,
  CitationVerdict,
} from '@fob/shared/knowledge/contracts';
import type { HybridSearchHit } from '@fob/shared/knowledge/search';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import type { AiBlockBinding, AiMarkdownContext } from '@fob/shared/knowledge/markdown';
import { isKnowledgeBlock } from '@fob/shared/knowledge/schema';
import { blockIndex, docState, page } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { authorizePageAccess, expandRequestPrincipals } from '../permissions/authorization';
import { indexedBlockAccessCondition } from '../permissions/queries';
import { PAGE_BODY_FRAGMENT } from '../search/backlinks';

const pipeline = createMarkdownPipeline();
type KnowledgeNode = ReturnType<(typeof pipeline.schema)['node']>;
type KnowledgeMark = ReturnType<(typeof pipeline.schema)['mark']>;

/** 与 H04 检索入口同一查询约束；超出即调用方错误。 */
const MAX_QUERY_LENGTH = 200;
/** 引用校验的单次裁决上限，与 C01 read_page.range 同一量级。 */
const MAX_CITATIONS = 100;
/** 预算口径：UTF-8 字节。默认值留出固定段与数十条检索块的余量，调用方可按模型档覆盖。 */
const DEFAULT_BUDGET_BYTES = 65_536;
/** valid 裁决摘要窗口；与 H04 摘要同宽。 */
const EXCERPT_WINDOW = 120;
/** AI 方言的块锚点（`{#b:id}`）不进入人读摘要。 */
const blockAnchor = /\s*\{#b:[A-Za-z0-9_-]+\}/g;

const utf8Bytes = (value: string) => Buffer.byteLength(value, 'utf8');

/**
 * y-prosemirror 存储编码的忠实只读解码（与 H01 索引器同一约定，但不执行 E02 修复：
 * 组装与校验绝不写回权威状态）。未注册节点类型等损坏正文抛错，由调用方按 fail
 * closed 处理。
 */
function decodeYNodes(text: Y.XmlText): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  for (const run of text.toDelta()) {
    if (typeof run.insert !== 'string' || !run.insert) continue;
    const marks: KnowledgeMark[] = [];
    for (const [name, value] of Object.entries(run.attributes ?? {})) {
      if (name === 'ychange') continue;
      marks.push(pipeline.schema.mark(/^(.*)--[a-zA-Z0-9+/=]{8}$/.exec(name)?.[1] ?? name, value as Record<string, unknown>));
    }
    nodes.push(pipeline.schema.text(run.insert, marks));
  }
  return nodes;
}

function decodeYElement(element: Y.XmlElement): KnowledgeNode {
  const type = pipeline.schema.nodes[element.nodeName];
  if (!type) throw new Error(`Page body contains an unregistered node type: ${element.nodeName}`);
  const children: KnowledgeNode[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) children.push(decodeYElement(child));
    else if (child instanceof Y.XmlText) children.push(...decodeYNodes(child));
    else throw new Error('Page body contains an unsupported Yjs hook');
  }
  return type.createChecked(element.getAttributes() as Record<string, unknown>, children);
}

function decodePageBody(document: Y.Doc): KnowledgeNode | null {
  const children: KnowledgeNode[] = [];
  for (const child of document.getXmlFragment(PAGE_BODY_FRAGMENT).toArray()) {
    if (child instanceof Y.XmlElement) children.push(decodeYElement(child));
    else if (child instanceof Y.XmlText) children.push(...decodeYNodes(child));
    else throw new Error('Page body contains an unsupported Yjs hook');
  }
  return children.length ? pipeline.schema.topNodeType.createChecked(null, children) : null;
}

/**
 * 以 doc_state 为唯一权威解码正文并构建 M02 AI 方言上下文。无 doc_state（正文
 * 从未持久化或页面已删）返回 null；解码或锚点校验失败同样返回 null——读取路径对
 * 损坏正文 fail closed（留待 doc.changed 消费者修复），不阻塞其余分段。
 */
async function loadPageAiContext(db: ResourceTransaction, scope: { knowledgeBaseId: string; pageId: string }): Promise<{ document: KnowledgeNode; context: AiMarkdownContext } | null> {
  const [stored] = await db.select({ state: docState.state }).from(docState)
    .where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
  if (!stored) return null;
  try {
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(stored.state));
    const model = decodePageBody(document);
    return model ? { document: model, context: pipeline.createAiContext(model) } : null;
  } catch {
    return null;
  }
}

/** 页面大纲（§9.6 标题树）：文档序标题块 + 级别与标题文本，逐项带 blockId。 */
function collectOutlineEntries(document: KnowledgeNode): ContextOutlineEntry[] {
  const entries: ContextOutlineEntry[] = [];
  document.descendants((node) => {
    if (node.type.name !== 'heading' || !isKnowledgeBlock(node)) return;
    const blockId = node.attrs.blockId;
    if (typeof blockId !== 'string' || !blockIdSchema.safeParse(blockId).success) return;
    const level = typeof node.attrs.level === 'number' && Number.isInteger(node.attrs.level) && node.attrs.level >= 1 && node.attrs.level <= 6 ? node.attrs.level : 2;
    entries.push({ blockId, level, title: node.textContent });
  });
  return entries;
}

/** 从页面自身沿 parentId 上溯收集标题（去空），构成大纲段的页面路径。 */
async function readPageTitlePath(db: ResourceTransaction, scope: { knowledgeBaseId: string; pageId: string }): Promise<string[]> {
  const titles: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = scope.pageId;
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const [row] = await db.select({ parentId: page.parentId, title: page.title }).from(page)
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, cursor)));
    if (!row) break;
    titles.unshift(row.title);
    cursor = row.parentId;
  }
  return titles.filter((title) => title.length > 0);
}

function excerptOf(markdown: string): string {
  const text = markdown.replace(blockAnchor, '').replace(/\s+/g, ' ').trim();
  return `${text.slice(0, EXCERPT_WINDOW)}${text.length > EXCERPT_WINDOW ? '…' : ''}`;
}

export interface AssembleContextFocus {
  readonly pageId: string;
  /** 焦点块（选区/光标所在）；缺省时只组装大纲腿，不组装邻块腿。 */
  readonly blockId?: string;
}

export interface AssembleContextInput {
  readonly knowledgeBaseId: string;
  readonly userId: string;
  readonly taskKind: ContextTaskKind;
  /** 检索腿查询（与调用方执行 H04 检索所用同一次查询）；空白则无检索腿。 */
  readonly query?: string;
  /**
   * H04 `searchHybrid` 以同一发起者身份取得的命中（已是可见集）。组装在权限谓词
   * 内回读权威索引正文；检索之后失权或消失的命中按 `unavailableRetrievalHits`
   * 如实剔除。真实模型调用属 J04+，本层不触网关。
   */
  readonly searchHits?: readonly HybridSearchHit[];
  readonly focus?: AssembleContextFocus;
  readonly history?: readonly ContextHistoryMessage[];
  /** 预算（UTF-8 字节）；超限仅从检索腿尾部整条剔除，固定段不截。 */
  readonly budgetBytes?: number;
}

export interface ValidateCitationsInput {
  readonly knowledgeBaseId: string;
  readonly userId: string;
  /** 模型回答中的块引用候选（pageId + blockId 自由文本，畸形引用裁决为 invalid）。 */
  readonly citedBlockIds: readonly { readonly pageId: string; readonly blockId: string }[];
}

interface FocusLegs {
  readonly outline: { readonly pageId: string; readonly titlePath: readonly string[]; readonly entries: readonly ContextOutlineEntry[] };
  readonly neighbors: { readonly pageId: string; readonly focusBlockId: string; readonly blocks: readonly ContextNeighborBlock[] } | null;
}

/**
 * 焦点页两腿：P03 `authorizePageAccess(view)` 唯一入口授权；拒绝/围栏/页面缺失时
 * 返回 null（两腿整体 fail closed，其余分段不受影响）。授权通过后以 doc_state 为
 * 权威取标题树与邻块——邻块经 M02 `createAiContext().read()` 按锚点读取，切片自带
 * `{#b:id}`；焦点块不存在于权威文档（已删除）时仅跳过邻块腿。
 */
async function loadFocusLegs(db: ResourceTransaction, input: { knowledgeBaseId: string; userId: string; focus: AssembleContextFocus }): Promise<FocusLegs | null> {
  const scope = { knowledgeBaseId: input.knowledgeBaseId, pageId: input.focus.pageId };
  const decision = await authorizePageAccess(db, { userId: input.userId, scope, required: 'view' });
  if (decision.decision !== 'allow') return null;
  const titlePath = await readPageTitlePath(db, scope);
  const loaded = await loadPageAiContext(db, scope);
  if (!loaded) return { outline: { pageId: scope.pageId, titlePath, entries: [] }, neighbors: null };
  const entries = collectOutlineEntries(loaded.document);
  let neighbors: FocusLegs['neighbors'] = null;
  const focusIndex = input.focus.blockId ? loaded.context.blocks.findIndex((binding) => binding.blockId === input.focus.blockId) : -1;
  if (focusIndex >= 0) {
    // 焦点块 + 前/后各一块，M02 read() 按锚点读取（切片自带 {#b:id}，文档序返回）。
    const picks: { binding: AiBlockBinding; relation: ContextNeighborBlock['relation'] }[] = [];
    if (focusIndex > 0) picks.push({ binding: loaded.context.blocks[focusIndex - 1]!, relation: 'before' });
    picks.push({ binding: loaded.context.blocks[focusIndex]!, relation: 'focus' });
    if (focusIndex + 1 < loaded.context.blocks.length) picks.push({ binding: loaded.context.blocks[focusIndex + 1]!, relation: 'after' });
    const markdownById = new Map(loaded.context.read(picks.map((pick) => pick.binding.blockId)).map((read) => [read.binding.blockId, read.markdown]));
    neighbors = {
      pageId: scope.pageId,
      focusBlockId: input.focus.blockId!,
      blocks: picks.map((pick) => ({
        pageId: scope.pageId,
        blockId: pick.binding.blockId,
        blockType: pick.binding.type,
        relation: pick.relation,
        markdown: markdownById.get(pick.binding.blockId)!,
      })),
    };
  }
  return { outline: { pageId: scope.pageId, titlePath, entries }, neighbors };
}

/** 检索腿正文回读：与 H04 同一 `indexedBlockAccessCondition` 谓词（先于任何装配）。 */
async function enrichRetrieval(db: ResourceTransaction, input: {
  knowledgeBaseId: string;
  userId: string;
  hits: readonly HybridSearchHit[];
}): Promise<{ items: ContextRetrievalItem[]; unavailable: number }> {
  const principals = await expandRequestPrincipals(db, input.knowledgeBaseId, input.userId);
  if (!principals.length) return { items: [], unavailable: input.hits.length };
  const rows = input.hits.length ? await db.select({
    pageId: blockIndex.pageId,
    blockId: blockIndex.blockId,
    blockType: blockIndex.blockType,
    titlePath: blockIndex.titlePath,
    contentMd: blockIndex.contentMd,
  }).from(blockIndex).where(and(
    indexedBlockAccessCondition({ knowledgeBaseId: input.knowledgeBaseId, principals: [...principals] }),
    or(...input.hits.map((hit) => and(eq(blockIndex.pageId, hit.pageId), eq(blockIndex.blockId, hit.blockId)))),
  )) : [];
  const byKey = new Map(rows.map((row) => [`${row.pageId}:${row.blockId}`, row]));
  const items: ContextRetrievalItem[] = [];
  let unavailable = 0;
  for (const hit of input.hits) {
    const row = byKey.get(`${hit.pageId}:${hit.blockId}`);
    if (!row) {
      unavailable += 1;
      continue;
    }
    items.push({
      pageId: row.pageId,
      blockId: row.blockId,
      blockType: row.blockType,
      titlePath: row.titlePath ?? null,
      contentMd: row.contentMd,
      sources: hit.sources,
    });
  }
  return { items, unavailable };
}

function rulesText(taskKind: ContextTaskKind): string {
  const lines = taskKind === 'ask' ? [
    '你是 Fob 知识库中的 AI 协作者，只能依据下方上下文回答。',
    '- 上下文是知识库 AI 方言 Markdown：每个块的末尾带 {#b:块ID} 锚点；:::fob-derived 容器是媒体派生文本，只读。',
    '- 回答引用事实时必须给出出处块的 pageId 与锚点中的 blockId；只能引用上下文中出现的块，不得编造。',
    '- 上下文之外的结论需明确说明没有知识库依据。',
  ] : [
    '你是 Fob 知识库中的 AI 协作者，对目标块的修改以建议模式写回。',
    '- 上下文是知识库 AI 方言 Markdown：每个块的末尾带 {#b:块ID} 锚点；:::fob-derived 容器是媒体派生文本，只读。',
    '- 目标位置由锚点标识；输出只覆盖请求的改动，不改动未提及的块。',
    '- 说明改动依据时给出处块的 pageId 与 blockId，只能引用上下文中出现的块。',
  ];
  return lines.join('\n');
}

const outlineText = (leg: FocusLegs['outline']) => [
  '## 当前页面大纲',
  `页面：${leg.titlePath.length ? `${leg.titlePath.join(' > ')} ` : ''}(pageId:${leg.pageId})`,
  ...leg.entries.map((entry) => `${'  '.repeat(entry.level - 1)}- ${'#'.repeat(entry.level)} ${entry.title} {#b:${entry.blockId}}`),
].join('\n');

const neighborsText = (leg: NonNullable<FocusLegs['neighbors']>) => [
  `## 焦点块与邻块(pageId:${leg.pageId})`,
  ...leg.blocks.map((block) => [`<!-- ${block.relation} -->`, block.markdown].join('\n')),
].join('\n\n');

const retrievalHeader = (query: string) => `## 检索到的相关块(查询:${query})`;

const retrievalItemText = (item: ContextRetrievalItem, index: number) =>
  `### ${index + 1}. pageId:${item.pageId}${item.titlePath ? ` · ${item.titlePath}` : ''}\n${item.contentMd}`;

const historyText = (messages: readonly ContextHistoryMessage[]) =>
  ['## 对话历史', ...messages.map((message) => `${message.role}: ${message.content}`)].join('\n');

const segmentBytes = (segments: readonly { text: string }[]) => segments.reduce((total, segment) => total + utf8Bytes(segment.text), 0);

/**
 * J01 上下文组装（§9.6）：固定规则 → 页面大纲（标题树+blockId）→ 焦点块邻块
 * （M02 锚点读取）→ 混合检索块（H04 命中的权威正文）→ 对话历史，逐段带来源标记
 * 与实际字节数。纯读取逻辑，不触模型网关；焦点授权与检索正文回读共享一个租户
 * 事务快照。预算口径为 UTF-8 字节：超限时按命中名次从检索腿尾部整条剔除
 * （固定段不截）；固定段自身超预算时如实返回 `overBudgetBytes`。
 */
export async function assembleContext(pool: Pool, input: AssembleContextInput): Promise<AssembledContext> {
  if (!entityIdSchema.safeParse(input.knowledgeBaseId).success || !entityIdSchema.safeParse(input.userId).success) throw new TypeError('Invalid context assembly scope');
  if (!contextTaskKindSchema.safeParse(input.taskKind).success) throw new TypeError('Invalid context task kind');
  const query = input.query?.trim() ?? '';
  if (query.length > MAX_QUERY_LENGTH) throw new TypeError('Invalid context assembly query');
  const history = input.history ?? [];
  if (!history.every((message) => contextHistoryMessageSchema.safeParse(message).success)) throw new TypeError('Invalid context history');
  const budgetBytes = input.budgetBytes ?? DEFAULT_BUDGET_BYTES;
  if (!Number.isInteger(budgetBytes) || budgetBytes < 1) throw new TypeError('Invalid context budget');
  const hits = query && input.searchHits?.length ? input.searchHits : [];

  const { focusLegs, retrieval } = await withKnowledgeBase(pool, input.knowledgeBaseId, async (db) => {
    const focusLegs = input.focus ? await loadFocusLegs(db, { knowledgeBaseId: input.knowledgeBaseId, userId: input.userId, focus: input.focus }) : null;
    const retrieval = hits.length ? await enrichRetrieval(db, { knowledgeBaseId: input.knowledgeBaseId, userId: input.userId, hits }) : { items: [], unavailable: 0 };
    return { focusLegs, retrieval };
  });

  const rulesTextValue = rulesText(input.taskKind);
  const outlineTextValue = focusLegs ? outlineText(focusLegs.outline) : null;
  const neighborsTextValue = focusLegs?.neighbors ? neighborsText(focusLegs.neighbors) : null;
  const historyTextValue = history.length ? historyText(history) : null;

  const rulesSegment: ContextSegment = { kind: 'rules', text: rulesTextValue, bytes: utf8Bytes(rulesTextValue) };
  const outlineSegment: ContextSegment | null = focusLegs && outlineTextValue !== null ? {
    kind: 'outline',
    pageId: focusLegs.outline.pageId,
    titlePath: [...focusLegs.outline.titlePath],
    entries: [...focusLegs.outline.entries],
    text: outlineTextValue,
    bytes: utf8Bytes(outlineTextValue),
  } : null;
  const neighborsSegment: ContextSegment | null = focusLegs?.neighbors && neighborsTextValue !== null ? {
    kind: 'neighbors',
    pageId: focusLegs.neighbors.pageId,
    focusBlockId: focusLegs.neighbors.focusBlockId,
    blocks: [...focusLegs.neighbors.blocks],
    text: neighborsTextValue,
    bytes: utf8Bytes(neighborsTextValue),
  } : null;
  const historySegment: ContextSegment | null = historyTextValue !== null ? {
    kind: 'history',
    messages: [...history],
    text: historyTextValue,
    bytes: utf8Bytes(historyTextValue),
  } : null;

  const head: ContextSegment[] = [];
  head.push(rulesSegment);
  if (outlineSegment) head.push(outlineSegment);
  if (neighborsSegment) head.push(neighborsSegment);
  const fixedBytes = segmentBytes(head) + (historySegment?.bytes ?? 0);

  // 预算截断只作用于检索腿：按命中名次从尾部整条剔除，直到总字节落入预算或检索腿
  // 清空；剔除以渲染后字节精确计算，不做中途截断（半条引用会诱发幻觉锚点）。
  const itemTexts = retrieval.items.map((item, index) => retrievalItemText(item, index));
  const headerBytes = utf8Bytes(retrievalHeader(query));
  const itemBytes = itemTexts.map(utf8Bytes);
  const separatorBytes = utf8Bytes('\n\n');
  const retrievalBytes = (count: number) => (count > 0 ? headerBytes + itemBytes.slice(0, count).reduce((total, bytes, index) => total + bytes + (index > 0 ? separatorBytes : 0), 0) + separatorBytes : 0);
  let kept = retrieval.items.length;
  while (kept > 0 && fixedBytes + retrievalBytes(kept) > budgetBytes) kept -= 1;

  const retrievalText = kept > 0 ? `${retrievalHeader(query)}\n\n${itemTexts.slice(0, kept).join('\n\n')}` : null;
  const retrievalSegment: ContextSegment | null = retrievalText !== null ? {
    kind: 'retrieval',
    query,
    items: retrieval.items.slice(0, kept),
    text: retrievalText,
    bytes: utf8Bytes(retrievalText),
  } : null;
  const segments: ContextSegment[] = [...head];
  if (retrievalSegment) segments.push(retrievalSegment);
  if (historySegment) segments.push(historySegment);
  const totalBytes = segmentBytes(segments);
  const usage: ContextUsage = {
    budgetBytes,
    totalBytes,
    truncated: kept < retrieval.items.length,
    droppedRetrievalItems: retrieval.items.length - kept,
    unavailableRetrievalHits: retrieval.unavailable,
    overBudgetBytes: Math.max(0, totalBytes - budgetBytes),
  };
  return { taskKind: input.taskKind, segments, usage };
}

/**
 * J01 引用校验（§9.6「回答时必须引用 blockId」的防幻觉关卡）：每条模型引用必须
 * 解析为发起者当前可见的真实块。可见性以 doc_state 权威文档为准（P03
 * `authorizePageAccess(view)` 唯一入口逐页授权），因此未被索引的布局容器块也可
 * 校验。不存在、无权与已回收折叠为同一 `invalid`（P03 惯例：三类拒绝不可区分，
 * 引用探测不泄漏块/页面存在性）；畸形引用原样回显裁决为 `invalid`。重复引用按
 * 首次出现顺序去重。
 */
export async function validateCitations(pool: Pool, input: ValidateCitationsInput): Promise<CitationVerdict[]> {
  if (!entityIdSchema.safeParse(input.knowledgeBaseId).success || !entityIdSchema.safeParse(input.userId).success) throw new TypeError('Invalid citation validation scope');
  if (!Array.isArray(input.citedBlockIds) || input.citedBlockIds.length > MAX_CITATIONS
    || !input.citedBlockIds.every((candidate) => typeof candidate?.pageId === 'string' && typeof candidate?.blockId === 'string')) {
    throw new TypeError('Invalid citation candidates');
  }

  return withKnowledgeBase(pool, input.knowledgeBaseId, async (db) => {
    // 首次出现顺序去重；按 pageId 分组，逐页一次授权 + 一次权威读取。
    const order: string[] = [];
    const byPage = new Map<string, { pageId: string; blockId: string }[]>();
    for (const candidate of input.citedBlockIds) {
      if (!byPage.has(candidate.pageId)) {
        byPage.set(candidate.pageId, []);
        order.push(candidate.pageId);
      }
      const group = byPage.get(candidate.pageId)!;
      if (!group.some((seen) => seen.blockId === candidate.blockId)) group.push(candidate);
    }

    const verdicts: CitationVerdict[] = [];
    for (const pageId of order) {
      const candidates = byPage.get(pageId)!;
      let title: string | null = null;
      let context: AiMarkdownContext | null = null;
      if (entityIdSchema.safeParse(pageId).success) {
        const scope = { knowledgeBaseId: input.knowledgeBaseId, pageId };
        const decision = await authorizePageAccess(db, { userId: input.userId, scope, required: 'view' });
        if (decision.decision === 'allow') {
          const [row] = await db.select({ title: page.title }).from(page)
            .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
          if (row) {
            title = row.title;
            context = (await loadPageAiContext(db, scope))?.context ?? null;
          }
        }
      }
      for (const candidate of candidates) {
        const known = context?.blocks.some((binding) => binding.blockId === candidate.blockId) ?? false;
        verdicts.push(known && title !== null
          ? {
            status: 'valid',
            pageId,
            blockId: candidate.blockId,
            pageTitle: title,
            excerpt: excerptOf(context!.read([candidate.blockId])[0]!.markdown),
          }
          : { status: 'invalid', pageId, blockId: candidate.blockId });
      }
    }
    return verdicts;
  });
}

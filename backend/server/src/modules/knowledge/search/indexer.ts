import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { pageScopeSchema } from '@fob/shared/knowledge/contracts';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { isKnowledgeBlock, planBlockIdRepairs } from '@fob/shared/knowledge/schema';
import type { BlockIdRepair } from '@fob/shared/knowledge/schema';
import { blockIndex, docState, page } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { withPermissionIndexWrite } from '../permissions/projection';
import type { KnowledgeConsumer } from '../workers/types';
import { PAGE_BODY_FRAGMENT, refreshPageBacklinks } from './backlinks';

const pipeline = createMarkdownPipeline();
const schema = pipeline.schema;
type KnowledgeNode = ReturnType<(typeof schema)['node']>;
type KnowledgeMark = ReturnType<(typeof schema)['mark']>;


/** 短块的 AI Markdown 不超过该长度时，附带标题路径作为检索呈现上下文（设计 §7.1）。 */
const SHORT_BLOCK_CONTEXT_LIMIT = 120;
const writeBatchSize = 250;
/** y-prosemirror 以 `mark名--哈希` 存储可自重叠的 mark；解码时取 `--` 前的名字。 */
const hashedMarkName = /^(.*)--[a-zA-Z0-9+/=]{8}$/;

const sha256Hex = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

function textNodes(text: Y.XmlText): KnowledgeNode[] {
  const nodes: KnowledgeNode[] = [];
  for (const run of text.toDelta()) {
    if (typeof run.insert !== 'string' || !run.insert) continue;
    nodes.push(schema.text(run.insert, marksFromAttributes(run.attributes)));
  }
  return nodes;
}

function marksFromAttributes(attributes: Record<string, unknown> | undefined): KnowledgeMark[] {
  const marks: KnowledgeMark[] = [];
  for (const [name, value] of Object.entries(attributes ?? {})) {
    if (name === 'ychange') continue;
    marks.push(schema.mark(hashedMarkName.exec(name)?.[1] ?? name, value as Record<string, unknown>));
  }
  return marks;
}

/**
 * Y.XmlElement → ProseMirror 节点。这是 y-prosemirror 存储编码的忠实解码：
 * nodeName 即节点类型、attributes 即节点属性、Y.XmlText 的 delta 属性即文本
 * mark（后端不引入编辑器依赖，与 L01 直接读 Y 树同一约定）。createChecked
 * 让 schema 不合法的正文直接失败，交给消费者重试语义（与损坏 doc_state 同路）。
 */
function toNode(element: Y.XmlElement, elements: WeakMap<KnowledgeNode, Y.XmlElement>): KnowledgeNode {
  const type = schema.nodes[element.nodeName];
  if (!type) throw new Error(`Page body contains an unregistered node type: ${element.nodeName}`);
  const children: KnowledgeNode[] = [];
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlElement) children.push(toNode(child, elements));
    else if (child instanceof Y.XmlText) children.push(...textNodes(child));
    else throw new Error('Page body contains an unsupported Yjs hook');
  }
  const node = type.createChecked(element.getAttributes() as Record<string, unknown>, children);
  elements.set(node, element);
  return node;
}

interface PageBodyModel {
  /** null = 正文碎片为空（无任何可索引块）。 */
  readonly document: KnowledgeNode | null;
  /** E02 服务端修复计划；空 = 权威状态本就满足 blockId 完整性。 */
  readonly repairs: readonly BlockIdRepair[];
  readonly repaired: boolean;
}

interface DecodedPageBody {
  readonly document: KnowledgeNode | null;
  /** 首次解码的 PM 节点 → Y.XmlElement 映射，供修复按位置回写。 */
  readonly elements: Readonly<WeakMap<KnowledgeNode, Y.XmlElement>>;
}

function decodeBodyModel(body: Y.XmlFragment): DecodedPageBody {
  const elements = new WeakMap<KnowledgeNode, Y.XmlElement>();
  const build = (): KnowledgeNode | null => {
    const children: KnowledgeNode[] = [];
    for (const child of body.toArray()) {
      if (child instanceof Y.XmlElement) children.push(toNode(child, elements));
      else if (child instanceof Y.XmlText) children.push(...textNodes(child));
      else throw new Error('Page body contains an unsupported Yjs hook');
    }
    return children.length ? schema.topNodeType.createChecked(null, children) : null;
  };
  return { document: build(), elements };
}

/** 只读解码权威正文碎片（y-prosemirror 存储编码 → PM 模型）；null = 碎片为空。索引与 Agent 工具读取共用同一解码。 */
export function decodePageBody(body: Y.XmlFragment): KnowledgeNode | null {
  return decodeBodyModel(body).document;
}

/**
 * 解码正文碎片并执行 E02 服务端 blockId 修复。修复以共享注册表中的
 * planBlockIdRepairs（与 repairBlockIds 同一规则：缺失/非法/后出现的重复重新
 * 分配、invalid_source 只清洗来源）计算，再按位置映射回 Y.XmlElement 以
 * setAttribute 落回——正是编辑器 setNodeMarkup 经 updateYFragment 会产生的
 * Y 变更，因此可与并发编辑安全合并。修复后的模型从 Y 树重建，保证投影与
 * 回写状态一致。
 */
function loadPageBodyModel(body: Y.XmlFragment): PageBodyModel {
  const decoded = decodeBodyModel(body);
  const document = decoded.document;
  if (!document) return { document: null, repairs: [], repaired: false };
  const repairs = planBlockIdRepairs(document);
  if (!repairs.length) return { document, repairs, repaired: false };
  const owner = body.doc;
  if (!owner) throw new Error('Page body fragment is not integrated into a document');
  owner.transact(() => {
    for (const repair of repairs) {
      const node = document.nodeAt(repair.position);
      const element = node ? decoded.elements.get(node) : undefined;
      if (!element) throw new Error('Block ID repair lost its Yjs element');
      if (element.getAttribute('blockId') !== repair.blockId) element.setAttribute('blockId', repair.blockId);
      if (repair.sourceBlockId === null) element.removeAttribute('sourceBlockId');
      else if (element.getAttribute('sourceBlockId') !== repair.sourceBlockId) element.setAttribute('sourceBlockId', repair.sourceBlockId);
    }
  });
  return { document: decodeBodyModel(body).document, repairs, repaired: true };
}

export interface BlockIndexDraft {
  readonly blockId: string;
  readonly blockType: string;
  readonly contentMd: string;
  readonly contentHash: string;
  readonly titlePath: string | null;
}

interface BlockProjection { readonly drafts: readonly BlockIndexDraft[]; readonly skipped: number }

/**
 * 经 M02 的 AI 方言上下文生成每块索引文本：read() 的切片是该块权威载体
 * Markdown（含 `{#b:id}` 锚点与派生文本），即规范化的哈希输入。注册表
 * `index.mode==='skip'` 的布局容器（列表/表格/分栏等）不落行——它们的
 * 内容就是子块，逐块落行会重复；子块（列表项、单元格等）全部落行。
 * 标题路径按大纲语义维护：块所属标题 = 文档顺序中其上方最近的标题链
 * （标题是 textblock，不可能成为结构祖先，§4.1 块模型的嵌套容器均非标题）。
 */
function projectBlocks(document: KnowledgeNode, pageTitlePath: readonly string[]): BlockProjection {
  const context = pipeline.createAiContext(document);
  const reads = context.read();
  if (reads.length !== context.blocks.length) throw new Error('AI Markdown context lost block alignment');
  const headings = new Map<string, { level: number; title: string }>();
  document.descendants((node) => {
    if (node.type.name === 'heading' && isKnowledgeBlock(node) && typeof node.attrs.blockId === 'string') {
      headings.set(node.attrs.blockId, { level: typeof node.attrs.level === 'number' ? node.attrs.level : 2, title: node.textContent });
    }
  });
  const drafts: BlockIndexDraft[] = [];
  const outline: { level: number; title: string }[] = [];
  let skipped = 0;
  context.blocks.forEach((binding, index) => {
    const definition = pipeline.registry.get(binding.type);
    if (!definition) throw new Error(`Page body contains an unregistered block: ${binding.type}`);
    const contentMd = reads[index].markdown.trim();
    let titlePath: string | null = null;
    if (contentMd.length <= SHORT_BLOCK_CONTEXT_LIMIT) {
      titlePath = [...pageTitlePath, ...outline.map((entry) => entry.title)].filter((segment) => segment.length > 0).join(' > ') || null;
    }
    if (definition.index.mode === 'skip') skipped += 1;
    else drafts.push({ blockId: binding.blockId, blockType: binding.type, contentMd, contentHash: sha256Hex(contentMd), titlePath });
    if (binding.type === 'heading') {
      const heading = headings.get(binding.blockId);
      while (outline.length && outline[outline.length - 1]!.level >= (heading?.level ?? 2)) outline.pop();
      outline.push({ level: heading?.level ?? 2, title: heading?.title ?? '' });
    }
  });
  return { drafts, skipped };
}

/** 从页面自身沿 parentId 上溯收集标题（去空），构成短块的页面标题路径。 */
async function readPageTitlePath(db: ResourceTransaction, scope: PageScope): Promise<string[]> {
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

export interface PageBlockIndexRefresh {
  /** 新增的块行数。 */
  readonly inserted: number;
  /** contentHash/blockType/titlePath 任一变化的块行数。 */
  readonly updated: number;
  /** 正文已不存在（含差量删除）而清理的块行数。 */
  readonly deleted: number;
  /** 本次修复的 blockId 数量。 */
  readonly repaired: number;
  /** skip 容器块数（不落行，仅观测）。 */
  readonly skipped: number;
}

/**
 * 以 doc_state 为唯一权威重算某页的块索引投影。doc_state 行 FOR UPDATE 串行化
 * 同页并发索引（与 L01 反链消费者、后续重放共用同一锁序）；全部解析/修复/
 * Markdown 生成在进入 withPermissionIndexWrite 之前完成，短投影事务内只做
 * 差量 DML 并经 P02 端口同步 principals/aclRevision。差量为空时不对
 * block_index 产生任何写。修复改变了权威状态时同事务重算反链，使两个
 * doc.changed 消费者的任意执行顺序都收敛到修复后的同一结果。
 */
export async function refreshPageBlockIndex(db: ResourceTransaction, scope: PageScope, signal?: AbortSignal): Promise<PageBlockIndexRefresh> {
  if (!pageScopeSchema.safeParse(scope).success) throw new TypeError('Invalid page scope');
  signal?.throwIfAborted();
  const [stored] = await db.select({ state: docState.state }).from(docState)
    .where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId))).for('update');
  let drafts: BlockIndexDraft[] = [];
  let repaired = 0;
  let skipped = 0;
  if (stored) {
    const document = new Y.Doc();
    Y.applyUpdate(document, new Uint8Array(stored.state));
    const model = loadPageBodyModel(document.getXmlFragment(PAGE_BODY_FRAGMENT));
    if (model.document) {
      if (model.repaired) {
        repaired = model.repairs.length;
        // 与 onStoreDocument 相同的权威 upsert（state+vector 同事务）。
        await db.update(docState).set({
          state: Buffer.from(Y.encodeStateAsUpdate(document)),
          stateVector: Buffer.from(Y.encodeStateVector(document)),
          updatedAt: sql`clock_timestamp()`,
        }).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
      }
      signal?.throwIfAborted();
      const projection = projectBlocks(model.document, await readPageTitlePath(db, scope));
      drafts = [...projection.drafts];
      skipped = projection.skipped;
    }
  }
  signal?.throwIfAborted();
  const existing = await db.select({
    blockId: blockIndex.blockId, blockType: blockIndex.blockType, contentHash: blockIndex.contentHash, titlePath: blockIndex.titlePath,
  }).from(blockIndex).where(and(eq(blockIndex.knowledgeBaseId, scope.knowledgeBaseId), eq(blockIndex.pageId, scope.pageId)));
  const current = new Map(existing.map((row) => [row.blockId, row]));
  const desired = new Set(drafts.map((draft) => draft.blockId));
  const insert = drafts.filter((draft) => !current.has(draft.blockId));
  const update = drafts.filter((draft) => {
    const row = current.get(draft.blockId);
    return row !== undefined && (row.contentHash !== draft.contentHash || row.blockType !== draft.blockType || (row.titlePath ?? null) !== draft.titlePath);
  });
  const remove = existing.flatMap((row) => (desired.has(row.blockId) ? [] : [row.blockId]));
  if (insert.length || update.length || remove.length) {
    await withPermissionIndexWrite(db, scope, async (projection) => {
      if (remove.length) await db.delete(blockIndex).where(and(
        eq(blockIndex.knowledgeBaseId, scope.knowledgeBaseId), eq(blockIndex.pageId, scope.pageId), inArray(blockIndex.blockId, remove)));
      for (let offset = 0; offset < insert.length; offset += writeBatchSize) {
        await db.insert(blockIndex).values(insert.slice(offset, offset + writeBatchSize).map((draft) => ({
          knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, ...draft,
          principals: projection.principals, aclRevision: projection.aclRevision,
        }))).onConflictDoNothing();
      }
      for (const draft of update) {
        await db.update(blockIndex).set({
          blockType: draft.blockType, contentMd: draft.contentMd, contentHash: draft.contentHash, titlePath: draft.titlePath, updatedAt: sql`clock_timestamp()`,
        }).where(and(
          eq(blockIndex.knowledgeBaseId, scope.knowledgeBaseId), eq(blockIndex.pageId, scope.pageId), eq(blockIndex.blockId, draft.blockId)));
      }
    });
  }
  if (repaired) await refreshPageBacklinks(db, scope, signal);
  return { inserted: insert.length, updated: update.length, deleted: remove.length, repaired, skipped };
}

/** H01 的 doc.changed 消费者：正文每次权威持久化后重算该页块索引。 */
export function createBlockIndexConsumer(pool: Pool): KnowledgeConsumer {
  return {
    name: 'index_page_blocks',
    topic: 'doc.changed',
    async handle(event, context) {
      if (event.topic !== 'doc.changed') throw new TypeError('Unexpected event topic');
      await withKnowledgeBase(pool, event.knowledgeBaseId, (db) =>
        refreshPageBlockIndex(db, { knowledgeBaseId: event.knowledgeBaseId, pageId: event.pageId }, context.signal));
    },
  };
}

/** 测试与验收脚本使用的行级观察口；生产检索走 H03 的权限过滤查询。 */
export async function readPageBlockIndexRows(db: ResourceTransaction, scope: PageScope) {
  if (!pageScopeSchema.safeParse(scope).success) throw new TypeError('Invalid page scope');
  return db.select({
    blockId: blockIndex.blockId, blockType: blockIndex.blockType, contentMd: blockIndex.contentMd,
    contentHash: blockIndex.contentHash, titlePath: blockIndex.titlePath, principals: blockIndex.principals,
    aclRevision: blockIndex.aclRevision, rowId: blockIndex.id,
  }).from(blockIndex)
    .where(and(eq(blockIndex.knowledgeBaseId, scope.knowledgeBaseId), eq(blockIndex.pageId, scope.pageId)))
    .orderBy(asc(blockIndex.blockId));
}

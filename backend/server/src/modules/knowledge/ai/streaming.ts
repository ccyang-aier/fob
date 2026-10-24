import { randomUUID } from 'node:crypto';
import * as Y from 'yjs';
import type { Hocuspocus } from '@hocuspocus/server';
import { TRPCError } from '@trpc/server';
import type { Pool } from 'pg';
import { agentOrigin } from '@fob/shared/knowledge/collaboration';
import { eq } from 'drizzle-orm';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { ModelSettings } from '@fob/shared/knowledge/contracts';
import type {
  AiStreamingTaskSelector,
  AiStreamingTaskSnapshot,
  RevokeAiStreamingTaskResult,
  StartAiStreamingTaskInput,
} from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestContext } from '../access';
import type { NodeAnnotation } from '@fob/shared/knowledge/schema/suggestions';
import { newSuggestion } from '@fob/shared/knowledge/schema/suggestions';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { docState } from '../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { authorizePageAccess } from '../permissions/authorization';
import { pageDocumentName } from '@fob/shared/knowledge/collaboration';
import { createAgentAwarenessSession } from '../collaboration/agent-awareness';
import type { AgentAwarenessSession } from '../collaboration/agent-awareness';
import { PAGE_BODY_FRAGMENT, insertProseMirrorBlocks } from '../import-export/y-encoding';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { ModelGatewayError } from './gateway';
import type { ModelGateway } from './gateway';
import { assembleContext } from './context';

const pipeline = createMarkdownPipeline();

/** 建议归属与 J03 写工具同一格式：`agent:{userId}:{taskId}`。 */
const suggestionAuthor = (taskId: string) => agentOrigin(taskId);
const agentActor = (userId: string, taskId: string) => ({ kind: 'agent' as const, userId, taskId });
const utf8Chars = (markdown: string) => Array.from(markdown.trim()).length;
const nowIso = () => new Date().toISOString();

/** 模型流超时上限（与网关同口径）；流式不做重试——中途重放会造成重复写入。 */
const STREAM_TIMEOUT_MS = 300_000;
/** 终态快照保留上限：防止长驻进程无界增长，超限丢弃最早终态。 */
const RETAINED_FINAL_TASKS = 100;
const AGENT_COLOR = '#3b82f6';
const AGENT_NAME = 'AI 协作者';

export type KnowledgeStreamingTaskErrorCode =
  | 'target_not_accessible'
  | 'anchor_not_found'
  | 'task_not_found'
  | 'task_running'
  | 'not_task_initiator'
  | 'streaming_unavailable'
  | (string & {});

/** 边界安全错误：tRPC 层经 `toKnowledgeStreamingTrpcError` 映射为受控协议错误。 */
export class KnowledgeStreamingTaskError extends Error {
  constructor(
    readonly code: KnowledgeStreamingTaskErrorCode,
    readonly http: 'forbidden' | 'not_found' | 'conflict' | 'unavailable',
  ) {
    super(`Streaming task failed: ${code}`);
    this.name = 'KnowledgeStreamingTaskError';
  }
}

export function toKnowledgeStreamingTrpcError(error: unknown): TRPCError {
  if (error instanceof KnowledgeStreamingTaskError) {
    const code = error.http === 'forbidden' ? 'FORBIDDEN'
      : error.http === 'not_found' ? 'NOT_FOUND'
        : error.http === 'conflict' ? 'CONFLICT' : 'SERVICE_UNAVAILABLE';
    return new TRPCError({ code });
  }
  return new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
}

/**
 * 模型 Markdown 流的逐块切分器（§9.3「每完成一个块就写入一次」）：空行是块边界，
 * 围栏代码块内的空行不是。仅返回已完整到达的块；`flush` 取收尾残段（无尾随空行
 * 的最后一块）。
 *
 * 增量扫描：`scannedLines` 之前的行已确认无边界，围栏状态机只前进不回放——同一
 * 围栏行不会被开/关各消费一次。末段（最后一个换行之后）仍在生长，既不作边界
 * 判定也不进围栏状态机：单个尾随换行是软换行，不切块。
 */
export class MarkdownStreamSplitter {
  private pending = '';
  private fenceMarker: string | null = null;
  private scannedLines = 0;

  push(delta: string): string[] {
    this.pending += delta;
    const blocks: string[] = [];
    for (let block = this.extract(); block !== null; block = this.extract()) blocks.push(block);
    return blocks;
  }

  flush(): string | null {
    const tail = this.pending;
    this.pending = '';
    this.scannedLines = 0;
    this.fenceMarker = null;
    return tail.trim() ? tail : null;
  }

  private extract(): string | null {
    // 空串切分会产生一个幽灵空行且消费后仍是空串——不守卫则扫描永不前进。
    if (this.pending === '') return null;
    const lines = this.pending.split('\n');
    // 最后一段之前才是已完整到达的行；末段可能继续生长，留待下轮扫描。
    for (let index = this.scannedLines; index < lines.length - 1; index++) {
      const line = lines[index]!;
      const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (fence) {
        // 围栏状态跨 delta 持久：流可能恰好在围栏中间被切开。
        if (this.fenceMarker === null) this.fenceMarker = fence[1]![0]!;
        else if (fence[1]!.startsWith(this.fenceMarker)) this.fenceMarker = null;
        continue;
      }
      if (this.fenceMarker !== null || line.trim() !== '') continue;
      // 围栏外的空行：其前的全部行构成一个完整块；纯空白前缀直接消费。
      this.pending = lines.slice(index + 1).join('\n');
      this.scannedLines = 0;
      const block = lines.slice(0, index).join('\n');
      if (block.trim()) return block;
      return this.extract();
    }
    this.scannedLines = Math.max(this.scannedLines, lines.length - 1);
    return null;
  }
}

interface PageScope { knowledgeBaseId: string; pageId: string }
type Fragment = Y.XmlFragment | Y.XmlElement;

function findBlockLocation(container: Fragment, blockId: string): { parent: Fragment; element: Y.XmlElement } | undefined {
  for (const child of container.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.getAttribute('blockId') === blockId) return { parent: container, element: child };
    const nested = findBlockLocation(child, blockId);
    if (nested) return nested;
  }
  return undefined;
}

function parseMarkdownBlocks(markdown: string): ProseMirrorNode[] {
  const document = pipeline.parse(markdown);
  const blocks: ProseMirrorNode[] = [];
  document.forEach((block) => blocks.push(block));
  if (!blocks.length) throw new KnowledgeStreamingTaskError('invalid_response', 'unavailable');
  return blocks;
}

/** S03 存储约定：建议节点带 annotation，文本带 insert mark（与 J03 写工具一致）。 */
function annotateProposedBlocks(nodes: ProseMirrorNode[], metadata: ReturnType<typeof newSuggestion>): ProseMirrorNode[] {
  const annotation: NodeAnnotation = { type: 'suggestion_insert', attrs: metadata };
  const insertMark = nodes[0]!.type.schema.marks.suggestion_insert.create(metadata);
  const walk = (node: ProseMirrorNode): ProseMirrorNode => {
    if (node.isText && node.text != null) return node.type.schema.text(node.text, insertMark.addToSet(node.marks));
    const attrs: Record<string, unknown> = { ...node.attrs, annotations: [annotation] };
    if (node.type.spec.attrs?.blockId) attrs.blockId = randomUUID();
    const children: ProseMirrorNode[] = [];
    node.forEach((child) => children.push(walk(child)));
    return node.type.createChecked(attrs, children);
  };
  return nodes.map(walk);
}

function ownInsertion(element: Y.XmlElement, author: string): boolean {
  const annotations = element.getAttribute('annotations') as unknown as NodeAnnotation[] | null;
  return annotations?.some((item) => item.type === 'suggestion_insert' && item.attrs.author === author) ?? false;
}

interface PageWriteIdentity { userId: string; taskId: string; author: string }

interface WrittenBlock { readonly blockId: string | null }

/**
 * 页面正文写会话：授权由任务层在每次写入前复检（fail closed），本层只负责把建议
 * 块写进权威文档。在线走协作宿主 direct connection（协议客户端实时可见，宿主持久
 * 化钩子落 doc_state 与 doc.changed outbox）；无宿主时回退 headless doc_state+outbox
 * 直写（与 J03 写工具同一回退语义）。
 */
class PageWriteSession {
  private readonly createdAt = nowIso();
  private anchorElement: Y.XmlElement | null;

  private constructor(
    private readonly pool: Pool,
    private readonly scope: PageScope,
    private readonly identity: PageWriteIdentity,
    private readonly connection: Awaited<ReturnType<Hocuspocus['openDirectConnection']>> | null,
    private readonly mirror: Y.Doc | null,
    private readonly parent: Fragment,
    private readonly mode: 'after' | 'inside',
    anchorElement: Y.XmlElement | null,
  ) {
    this.anchorElement = anchorElement;
  }

  static async open(input: {
    pool: Pool;
    scope: PageScope;
    identity: PageWriteIdentity;
    hocuspocus?: Hocuspocus;
    anchor: { afterBlockId: string | null; insideBlockId: string | null };
  }): Promise<PageWriteSession> {
    const { identity } = input;
    const wantsAnchor = input.anchor.afterBlockId ?? input.anchor.insideBlockId;
    if (input.hocuspocus) {
      const connection = await input.hocuspocus.openDirectConnection(pageDocumentName(input.scope), {
        pageId: input.scope.pageId,
        actor: agentActor(identity.userId, identity.taskId),
      });
      const shared = connection.document;
      if (!shared) {
        await connection.disconnect();
        throw new KnowledgeStreamingTaskError('document_unavailable', 'unavailable');
      }
      const fragment = shared.getXmlFragment(PAGE_BODY_FRAGMENT);
      const located = wantsAnchor ? findBlockLocation(fragment, wantsAnchor) : undefined;
      if (wantsAnchor && !located) {
        await connection.disconnect();
        throw new KnowledgeStreamingTaskError('anchor_not_found', 'not_found');
      }
      return new PageWriteSession(input.pool, input.scope, identity, connection, null,
        located ? located.parent : fragment, located ? 'after' : 'inside', located?.element ?? null);
    }
    const mirror = new Y.Doc();
    const loaded = await withKnowledgeBase(input.pool, input.scope.knowledgeBaseId, async (db) => {
      const [row] = await db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, input.scope.pageId));
      return row?.state ?? null;
    });
    if (loaded) Y.applyUpdate(mirror, new Uint8Array(loaded));
    const fragment = mirror.getXmlFragment(PAGE_BODY_FRAGMENT);
    const located = wantsAnchor ? findBlockLocation(fragment, wantsAnchor) : undefined;
    if (wantsAnchor && !located) {
      mirror.destroy();
      throw new KnowledgeStreamingTaskError('anchor_not_found', 'not_found');
    }
    return new PageWriteSession(input.pool, input.scope, identity, null, mirror,
      located ? located.parent : fragment, located ? 'after' : 'inside', located?.element ?? null);
  }

  /** 追加一个完整 Markdown 块；返回其顶层块 blockId（供 Agent 光标定位）。 */
  async append(markdown: string): Promise<WrittenBlock> {
    const metadata = newSuggestion(this.identity.author, { createdAt: this.createdAt });
    const nodes = annotateProposedBlocks(parseMarkdownBlocks(markdown), metadata);
    if (this.connection) {
      await this.connection.transact(() => {
        this.insert(nodes);
      });
    } else {
      this.mirror!.transact(() => this.insert(nodes));
      await this.persistHeadless();
    }
    return { blockId: this.lastOwnTopLevelBlockId() };
  }

  private insert(nodes: ProseMirrorNode[]): void {
    let index: number;
    if (this.mode === 'inside') index = this.parent.length;
    else if (this.anchorElement) index = Math.max(0, this.parent.toArray().lastIndexOf(this.anchorElement) + 1);
    else index = this.parent.length;
    insertProseMirrorBlocks(this.parent, index, nodes);
    const children = this.parent.toArray();
    for (let position = children.length - 1; position >= 0; position--) {
      const child = children[position]!;
      if (child instanceof Y.XmlElement && ownInsertion(child, this.identity.author)) {
        this.anchorElement = child;
        break;
      }
    }
  }

  /** 本任务在该父容器内写入的最后一个顶层块 blockId。 */
  private lastOwnTopLevelBlockId(): string | null {
    for (const child of [...this.parent.toArray()].reverse()) {
      if (child instanceof Y.XmlElement && ownInsertion(child, this.identity.author)) {
        const blockId = child.getAttribute('blockId');
        return typeof blockId === 'string' ? blockId : null;
      }
    }
    return null;
  }

  /** 整体任务撤销：物理移除本任务建议插入的整棵子树；人写内容与其他来源不动。 */
  async revokeOwnInsertions(): Promise<number> {
    const counter = { count: 0 };
    if (this.connection) {
      await this.connection.transact((document) => {
        this.remove(document.getXmlFragment(PAGE_BODY_FRAGMENT), counter);
      });
    } else {
      this.mirror!.transact(() => this.remove(this.mirror!.getXmlFragment(PAGE_BODY_FRAGMENT), counter));
      await this.persistHeadless();
    }
    return counter.count;
  }

  private remove(fragment: Fragment, counter: { count: number }): void {
    for (const child of fragment.toArray()) {
      if (!(child instanceof Y.XmlElement)) continue;
      if (ownInsertion(child, this.identity.author)) {
        const index = fragment.toArray().lastIndexOf(child);
        if (index >= 0) {
          fragment.delete(index, 1);
          counter.count += 1;
          continue;
        }
      }
      this.remove(child, counter);
    }
  }

  private async persistHeadless(): Promise<void> {
    const state = Buffer.from(Y.encodeStateAsUpdate(this.mirror!));
    const stateVector = Buffer.from(Y.encodeStateVector(this.mirror!));
    const { userId, taskId } = this.identity;
    await withKnowledgeBase(this.pool, this.scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...this.scope, state, stateVector })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { state, stateVector, updatedAt: new Date() } });
      await appendKnowledgeOutbox(db, {
        topic: 'doc.changed', knowledgeBaseId: this.scope.knowledgeBaseId, pageId: this.scope.pageId,
        actor: agentActor(userId, taskId), occurredAt: nowIso(),
      });
    });
  }

  async close(): Promise<void> {
    try {
      await this.connection?.disconnect();
    } finally {
      this.mirror?.destroy();
    }
  }
}

interface StreamingTask {
  readonly snapshot: AiStreamingTaskSnapshot;
  readonly controller: AbortController;
  readonly settled: Promise<void>;
}

export interface KnowledgeStreamingTaskDeps {
  readonly pool: Pool;
  readonly gateway: ModelGateway;
  /** 协作宿主：提供时走 direct connection 实时广播 + Agent awareness；缺省 headless 回退。 */
  readonly hocuspocus?: Hocuspocus;
  /** 知识库模型档位设置解析；缺省使用平台默认绑定。 */
  readonly resolveSettings?: (knowledgeBaseId: string) => Promise<ModelSettings>;
}

export interface KnowledgeStreamingTasks {
  start(authority: KnowledgeRequestContext, input: StartAiStreamingTaskInput): Promise<AiStreamingTaskSnapshot>;
  cancel(authority: KnowledgeRequestContext, input: AiStreamingTaskSelector): Promise<AiStreamingTaskSnapshot>;
  get(authority: KnowledgeRequestContext, input: AiStreamingTaskSelector): Promise<AiStreamingTaskSnapshot>;
  revoke(authority: KnowledgeRequestContext, input: AiStreamingTaskSelector): Promise<RevokeAiStreamingTaskResult>;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof KnowledgeStreamingTaskError) return error.code;
  if (error instanceof ModelGatewayError) return error.code;
  return 'provider_unavailable';
}

const copySnapshot = (task: StreamingTask): AiStreamingTaskSnapshot => ({ ...task.snapshot });

function requireInitiator(task: StreamingTask, authority: KnowledgeRequestContext): void {
  if (task.snapshot.initiatedBy !== authority.userId) throw new KnowledgeStreamingTaskError('not_task_initiator', 'forbidden');
}

async function requirePageEdit(pool: Pool, userId: string, scope: PageScope): Promise<void> {
  const allowed = await withKnowledgeBase(pool, scope.knowledgeBaseId, async (db) => {
    const decision = await authorizePageAccess(db, { userId, scope, required: 'edit' });
    return decision.decision === 'allow';
  });
  if (!allowed) throw new KnowledgeStreamingTaskError('target_not_accessible', 'forbidden');
}

/**
 * J04 逐块流式 AI 任务服务（§9.3）：模型流式 Markdown 经切分器按完整块写入权威
 * Y.Doc（建议模式，author `agent:{userId}:{taskId}`），B09 awareness 全程发布 Agent
 * 光标；取消停止写入且已写部分保留审阅；整体撤销只移除本任务建议块，不影响人的
 * 编辑。任务状态保存在进程内注册表；J07 的持久长任务不在此列。
 */
export function createKnowledgeStreamingTasks(deps: KnowledgeStreamingTaskDeps): KnowledgeStreamingTasks {
  const tasks = new Map<string, StreamingTask>();

  /** 终态快照保留上限：超限从最早终态开始丢弃（运行中任务永不淘汰）。 */
  const enforceRetention = () => {
    const finalized = [...tasks.values()].filter((task) => task.snapshot.status !== 'running');
    for (const task of finalized.slice(0, Math.max(0, finalized.length - RETAINED_FINAL_TASKS))) tasks.delete(task.snapshot.taskId);
  };

  async function execute(task: StreamingTask, authority: KnowledgeRequestContext, input: StartAiStreamingTaskInput): Promise<void> {
    const { snapshot } = task;
    const scope = { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId };
    const identity: PageWriteIdentity = { userId: authority.userId, taskId: snapshot.taskId, author: suggestionAuthor(snapshot.taskId) };
    let session: PageWriteSession | null = null;
    let awareness: AgentAwarenessSession | null = null;
    const splitter = new MarkdownStreamSplitter();
    try {
      const assembled = await assembleContext(deps.pool, {
        knowledgeBaseId: input.knowledgeBaseId,
        userId: authority.userId,
        taskKind: 'ask',
        focus: { pageId: input.pageId, blockId: input.afterBlockId ?? input.insideBlockId ?? undefined },
      });
      const system = assembled.segments.map((segment) => segment.text).join('\n\n');
      session = await PageWriteSession.open({
        pool: deps.pool, scope, identity, hocuspocus: deps.hocuspocus,
        anchor: { afterBlockId: input.afterBlockId, insideBlockId: input.insideBlockId },
      });
      if (deps.hocuspocus) {
        awareness = await createAgentAwarenessSession(deps.hocuspocus, {
          documentName: pageDocumentName(scope),
          identity: { userId: authority.userId, taskId: snapshot.taskId, name: AGENT_NAME, color: AGENT_COLOR },
          signal: task.controller.signal,
        });
        awareness.publish({ isEditing: true });
      }

      const writeBlock = async (markdown: string) => {
        task.controller.signal.throwIfAborted();
        await requirePageEdit(deps.pool, authority.userId, scope);
        const written = await session!.append(markdown);
        snapshot.blocksWritten += 1;
        snapshot.charsWritten += utf8Chars(markdown);
        snapshot.updatedAt = nowIso();
        awareness?.publish(written.blockId
          ? { cursor: { anchor: written.blockId, head: written.blockId }, isEditing: true }
          : { isEditing: true });
      };

      const settings = (await deps.resolveSettings?.(input.knowledgeBaseId)) ?? {};
      const stream = deps.gateway.stream({
        context: { knowledgeBaseId: input.knowledgeBaseId, userId: authority.userId, taskId: snapshot.taskId },
        settings,
        tier: input.tier,
        system,
        messages: [{ role: 'user', content: input.prompt }],
        maxRetries: 0,
        timeoutMs: STREAM_TIMEOUT_MS,
        signal: task.controller.signal,
      });
      for await (const part of stream) {
        if (part.type === 'text-delta') for (const block of splitter.push(part.text)) await writeBlock(block);
        if (part.type === 'finish') {
          const tail = splitter.flush();
          if (tail) await writeBlock(tail);
        }
      }
      snapshot.status = 'done';
    } catch (error) {
      const cancelled = task.controller.signal.aborted
        || (error instanceof ModelGatewayError && error.code === 'cancelled')
        || (error instanceof Error && error.name === 'AbortError');
      if (cancelled) snapshot.status = 'cancelled';
      else {
        snapshot.status = 'failed';
        snapshot.errorCode = safeErrorCode(error);
      }
    } finally {
      snapshot.updatedAt = nowIso();
      try {
        await awareness?.stop();
      } finally {
        await session?.close();
      }
      enforceRetention();
    }
  }

  return {
    async start(authority, input) {
      await requirePageEdit(deps.pool, authority.userId, { knowledgeBaseId: input.knowledgeBaseId, pageId: input.pageId });
      const taskId = randomUUID();
      const snapshot: AiStreamingTaskSnapshot = {
        knowledgeBaseId: input.knowledgeBaseId,
        taskId,
        pageId: input.pageId,
        initiatedBy: authority.userId,
        status: 'running',
        blocksWritten: 0,
        charsWritten: 0,
        errorCode: null,
        startedAt: nowIso(),
        updatedAt: nowIso(),
        revokedAt: null,
      };
      let settle: () => void = () => {};
      const settled = new Promise<void>((resolve) => { settle = resolve; });
      const task: StreamingTask = { snapshot, controller: new AbortController(), settled };
      tasks.set(taskId, task);
      void execute(task, authority, input).then(settle, settle);
      return copySnapshot(task);
    },

    async cancel(authority, input) {
      const task = tasks.get(input.taskId);
      if (!task || task.snapshot.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeStreamingTaskError('task_not_found', 'not_found');
      requireInitiator(task, authority);
      if (task.snapshot.status === 'running') {
        task.controller.abort();
        await task.settled;
      }
      return copySnapshot(task);
    },

    async get(authority, input) {
      const task = tasks.get(input.taskId);
      if (!task || task.snapshot.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeStreamingTaskError('task_not_found', 'not_found');
      requireInitiator(task, authority);
      return copySnapshot(task);
    },

    async revoke(authority, input) {
      const task = tasks.get(input.taskId);
      if (!task || task.snapshot.knowledgeBaseId !== input.knowledgeBaseId) throw new KnowledgeStreamingTaskError('task_not_found', 'not_found');
      requireInitiator(task, authority);
      if (task.snapshot.status === 'running') throw new KnowledgeStreamingTaskError('task_running', 'conflict');
      const scope = { knowledgeBaseId: input.knowledgeBaseId, pageId: task.snapshot.pageId };
      await requirePageEdit(deps.pool, authority.userId, scope);
      const session = await PageWriteSession.open({
        pool: deps.pool, scope,
        identity: { userId: authority.userId, taskId: input.taskId, author: suggestionAuthor(input.taskId) },
        hocuspocus: deps.hocuspocus,
        anchor: { afterBlockId: null, insideBlockId: null },
      });
      let revokedBlocks: number;
      try {
        revokedBlocks = await session.revokeOwnInsertions();
      } finally {
        await session.close();
      }
      task.snapshot.revokedAt = nowIso();
      task.snapshot.updatedAt = nowIso();
      return { knowledgeBaseId: input.knowledgeBaseId, taskId: input.taskId, revokedBlocks };
    },
  };
}

// ── tRPC 边界的服务绑定 ────────────────────────────────────────────
// 组合根（runtime/测试）以真实依赖装配后绑定；router 过程经 getter 取用。
// 未绑定时过程返回 SERVICE_UNAVAILABLE，绝不静默降级。

let boundTasks: KnowledgeStreamingTasks | undefined;

export function bindKnowledgeStreamingTasks(tasks: KnowledgeStreamingTasks): void {
  boundTasks = tasks;
}

export function knowledgeStreamingTasks(): KnowledgeStreamingTasks {
  if (!boundTasks) throw new KnowledgeStreamingTaskError('streaming_unavailable', 'unavailable');
  return boundTasks;
}

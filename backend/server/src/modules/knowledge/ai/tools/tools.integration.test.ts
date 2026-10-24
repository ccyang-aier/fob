import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as Y from 'yjs';
import type {
  AgentGetBacklinksToolResult,
  AgentListPagesToolResult,
  AgentReadPageToolResult,
  DatabaseRowsPage,
  OutboxEvent,
  PropertyDefinition,
  Teamspace,
} from '@fob/shared/knowledge/contracts';
import type { Principal } from '@fob/shared/knowledge/contracts';
import { hybridSearchResultSchema } from '@fob/shared/knowledge/search';
import type { HybridSearchResult } from '@fob/shared/knowledge/search';
import { blockIndex, docState } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import type { KnowledgeRequestContext } from '../../access';
import { createModelGateway } from '../gateway';
import { createAuthorizedDatabase, createAuthorizedRow } from '../../databases/service';
import { replaceAuthorizedPageAcl } from '../../permissions/mutations';
import { rebuildPermissionSubtree } from '../../permissions/rebuild';
import { createPermissionsFixture } from '../../permissions/permissions-test-fixture';
import type { PermissionTestActor, PermissionsFixture } from '../../permissions/permissions-test-fixture';
import { PAGE_BODY_FRAGMENT, refreshPageBacklinks } from '../../search/backlinks';
import { refreshPageBlockIndex } from '../../search/indexer';
import { createAuthorizedShareLink } from '../../sharing/links';
import { KnowledgeAgentToolError } from './errors';
import { invokeKnowledgeAgentTool, knowledgeAgentTools } from '.';
import type { KnowledgeAgentSearchModels, KnowledgeAgentToolContext } from '.';

interface DraftLink { target?: string; targetBlockId?: string; pageId?: string }
interface DraftBlock {
  blockId?: string;
  nodeName?: string;
  attrs?: Record<string, string | number>;
  text?: string;
  links?: readonly DraftLink[];
  children?: readonly DraftBlock[];
}

/** 真实认证服务、真实页面树/授权物化、真实 PG 检索与 doc_state 读取。 */
describe('read-only knowledge agent tools', () => {
  let fixture: PermissionsFixture;
  const searchModels: KnowledgeAgentSearchModels = {
    gateway: createModelGateway({
      platform: { defaults: {}, providers: {} },
      providers: {},
      ollamaEndpoints: ['http://127.0.0.1:11434'],
      // 本知识库无生效嵌入模型、无 rerank 绑定：两阶段降级都不应发出外呼。
      fetch: async () => { throw new Error('unexpected outbound model call'); },
    }),
    embedBinding: { source: 'ollama', endpoint: 'http://127.0.0.1:11434', model: 'agent-tools-unused', dimensions: 8 },
  };
  const authorities = new Map<string, Promise<KnowledgeRequestContext>>();

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
  }, 120_000);
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await fixture.close();
  }, 30_000);
  beforeEach(async () => {
    await fixture.resetJobs();
    await fixture.server.database.admin.query(
      'DELETE FROM resources.block_embedding_staging; DELETE FROM resources.block_embedding_model; DELETE FROM resources.block_index; DELETE FROM resources.backlink',
    );
  });

  function authority(actor: PermissionTestActor = fixture.owner, knowledgeBaseId = fixture.alpha.id) {
    const key = `${knowledgeBaseId}:${actor.identity.userId}`;
    const issued = authorities.get(key) ?? fixture.authenticator.authenticate(
      new Request(`${fixture.server.origin}/agent-tools`, { headers: { cookie: actor.cookie } }), knowledgeBaseId);
    authorities.set(key, issued);
    return issued;
  }

  async function toolContext(actor: PermissionTestActor = fixture.owner, overrides: Partial<KnowledgeAgentToolContext> = {}): Promise<KnowledgeAgentToolContext> {
    return { pool: fixture.pool, authority: await authority(actor), search: searchModels, ...overrides };
  }

  async function failure(operation: () => Promise<unknown>): Promise<KnowledgeAgentToolError> {
    try {
      await operation();
    } catch (error) {
      expect(error).toBeInstanceOf(KnowledgeAgentToolError);
      return error as KnowledgeAgentToolError;
    }
    throw new Error('Expected the tool call to fail');
  }

  function encodeBody(blocks: readonly DraftBlock[]) {
    const document = new Y.Doc();
    const build = (block: DraftBlock): Y.XmlElement => {
      const element = new Y.XmlElement<Record<string, string | number>>(block.nodeName ?? 'paragraph');
      const attributes: Record<string, string | number> = { ...(block.attrs ?? {}) };
      if (block.blockId !== undefined) attributes.blockId = block.blockId;
      for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
      let at = 0;
      if (block.text) { const text = new Y.XmlText(); text.insert(0, block.text); element.insert(at++, [text]); }
      for (const link of block.links ?? []) {
        const anchor = new Y.XmlElement('wikiLink');
        if (link.target !== undefined) anchor.setAttribute('target', link.target);
        if (link.targetBlockId !== undefined) anchor.setAttribute('targetBlockId', link.targetBlockId);
        if (link.pageId !== undefined) anchor.setAttribute('pageId', link.pageId);
        element.insert(at++, [anchor]);
      }
      for (const child of block.children ?? []) element.insert(at++, [build(child)]);
      return element as unknown as Y.XmlElement;
    };
    document.transact(() => {
      const fragment = document.getXmlFragment(PAGE_BODY_FRAGMENT);
      for (const block of blocks) fragment.insert(fragment.length, [build(block)]);
    });
    return { state: Buffer.from(Y.encodeStateAsUpdate(document)), stateVector: Buffer.from(Y.encodeStateVector(document)) };
  }

  async function writeBody(node: { knowledgeBaseId: string; pageId: string }, blocks: readonly DraftBlock[], options: { corrupt?: boolean } = {}) {
    const scope = { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
    const encoded = options.corrupt
      ? { state: Buffer.from([0x02, 0xff, 0xff, 0xff]), stateVector: Buffer.alloc(0) }
      : encodeBody(blocks);
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) =>
      db.insert(docState).values({ ...scope, ...encoded })
        .onConflictDoUpdate({ target: [docState.knowledgeBaseId, docState.pageId], set: { ...encoded, updatedAt: sql`clock_timestamp()` } }));
  }

  /** L01+H01 的直接重算：本文件不依赖队列消费者。 */
  async function indexPage(node: { knowledgeBaseId: string; pageId: string }, options: { backlinks?: boolean } = { backlinks: true }) {
    const scope = { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId };
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, async (db) => {
      if (options.backlinks) await refreshPageBacklinks(db, scope);
      await refreshPageBlockIndex(db, scope);
    });
  }

  /** fixture.tree() 为每页种一行权限金丝雀索引；检索断言前清掉。 */
  async function tree(options: Parameters<typeof fixture.tree>[0]) {
    const created = await fixture.tree(options);
    await fixture.drain();
    await withKnowledgeBase(fixture.pool, created.root.knowledgeBaseId, (db) => db.delete(blockIndex).where(and(
      eq(blockIndex.knowledgeBaseId, created.root.knowledgeBaseId),
      inArray(blockIndex.pageId, created.pages.map((node) => node.pageId)),
    )));
    return created;
  }

  async function grant(node: { knowledgeBaseId: string; pageId: string }, principalText: string, level: 'view' | 'edit' | 'full') {
    await withKnowledgeBase(fixture.pool, node.knowledgeBaseId, (db) =>
      replaceAuthorizedPageAcl(db, { knowledgeBaseId: node.knowledgeBaseId, pageId: node.pageId, grants: [{ principal: principalText as Principal, level }] }));
    await fixture.drain();
  }

  /**
   * 直接按最新 acl.changed 载荷重算子树（databases 测试同款）：数据库行创建还会
   * 发 knowledgeBase.event，仅含 rebuild 消费者的 drain 会因此永远等不到清空。
   */
  async function rebuildLatest(rootPageId: string, knowledgeBaseId = fixture.alpha.id) {
    const result = await fixture.server.database.admin.query<{ payload: OutboxEvent }>(
      "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='acl.changed' AND payload->>'rootPageId'=$2 ORDER BY (payload->>'revision')::bigint DESC LIMIT 1",
      [knowledgeBaseId, rootPageId],
    );
    if (!result.rows[0]) throw new Error('Expected an acl.changed event');
    const payload = result.rows[0].payload as Extract<OutboxEvent, { topic: 'acl.changed' }>;
    await withKnowledgeBase(fixture.pool, knowledgeBaseId, (db) => rebuildPermissionSubtree(db, payload));
  }

  const ownerPrincipal = () => `user:${fixture.owner.identity.userId}` as Principal;

  describe('registry and request identity', () => {
    test('unknown tools, forged authorities, write-only PATs and invalid inputs are rejected with structured codes', async () => {
      const context = await toolContext();
      const unknown = await failure(async () => invokeKnowledgeAgentTool('drop_database', {}, context));
      expect(unknown.code).toBe('UNKNOWN_TOOL');

      const forged = await failure(async () => invokeKnowledgeAgentTool('list_pages', {}, {
        pool: fixture.pool,
        authority: { knowledgeBaseId: fixture.alpha.id, userId: fixture.owner.identity.userId } as KnowledgeRequestContext,
      }));
      expect(forged.code).toBe('UNAUTHENTICATED');

      const invalid = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: 'not-a-uuid' }, context));
      expect(invalid.code).toBe('INVALID_TOOL_INPUT');
      expect(invalid.tool).toBe('read_page');

      const bearer = await fixture.createToken(fixture.reader, ['write']);
      const patContext = await fixture.authenticator.authenticate(
        new Request(`${fixture.server.origin}/agent-tools`, { headers: { authorization: bearer } }), fixture.alpha.id);
      const scoped = await failure(async () => invokeKnowledgeAgentTool('list_pages', {}, { pool: fixture.pool, authority: patContext }));
      expect(scoped.code).toBe('INSUFFICIENT_SCOPE');

      // 注册表即 §9.2 只读全集，名称稳定供 J04/K01 装配。
      expect(knowledgeAgentTools.map((tool) => tool.name)).toEqual(['search', 'read_page', 'query_database', 'list_pages', 'get_backlinks', 'insert', 'replace', 'delete', 'create_page', 'update_properties']);
    }, 30_000);

    test('non-members cannot obtain a request context for the knowledgeBase at all', async () => {
      await expect(fixture.authenticator.authenticate(
        new Request(`${fixture.server.origin}/agent-tools`, { headers: { cookie: fixture.foreign.cookie } }), fixture.alpha.id,
      )).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }, 30_000);
  });

  describe('search tool', () => {
    test('runs both legs inside the initiator predicate; filters and limit apply over the fused window', async () => {
      const shared = await tree({ parents: [null] });
      const [sharedPage] = shared.pages;
      const privateTree = await tree({ parents: [null], defaultAccess: null });
      const [privatePage] = privateTree.pages;
      await grant(privatePage, ownerPrincipal(), 'full');
      await writeBody(sharedPage, [
        { blockId: 's-head', nodeName: 'heading', attrs: { level: 2 }, text: '北极星基准的可见标题' },
        { blockId: 's-para', text: '北极星基准的普通段落说明' },
      ]);
      await writeBody(privatePage, [{ blockId: 'p-para', text: '北极星基准的私有段落内容' }]);
      await indexPage(sharedPage, { backlinks: false });
      await indexPage(privatePage, { backlinks: false });

      const ownerResult = await invokeKnowledgeAgentTool('search', { query: '北极星基准' }, await toolContext()) as HybridSearchResult;
      expect(hybridSearchResultSchema.parse(ownerResult)).toEqual(ownerResult);
      expect(ownerResult.vectorLeg).toEqual({ status: 'skipped', reason: 'no_active_model' });
      expect(ownerResult.hits.map((hit) => hit.blockId).sort()).toEqual(['p-para', 's-head', 's-para']);

      const readerResult = await invokeKnowledgeAgentTool('search', { query: '北极星基准' }, await toolContext(fixture.reader)) as HybridSearchResult;
      // BM25 名次与关键词腿一致；此处只断言可见集合：私有块绝不进入读者的任何一腿。
      expect(readerResult.hits.map((hit) => hit.blockId).sort()).toEqual(['s-head', 's-para']);

      const headingsOnly = await invokeKnowledgeAgentTool('search', {
        query: '北极星基准', filters: { blockTypes: ['heading'] },
      }, await toolContext()) as HybridSearchResult;
      expect(headingsOnly.hits.map((hit) => hit.blockId)).toEqual(['s-head']);

      const limited = await invokeKnowledgeAgentTool('search', { query: '北极星基准', limit: 1 }, await toolContext()) as HybridSearchResult;
      expect(limited.hits).toHaveLength(1);

      const outsidePage = await invokeKnowledgeAgentTool('search', {
        query: '北极星基准', filters: { pageIds: [randomUUID()] },
      }, await toolContext()) as HybridSearchResult;
      expect(outsidePage.hits).toEqual([]);
    }, 90_000);

    test('a missing search model dependency is a structured error, not a crash', async () => {
      const missing = await failure(async () => invokeKnowledgeAgentTool('search', { query: '任何词' }, await toolContext(fixture.owner, { search: undefined })));
      expect(missing.code).toBe('MODEL_DEPENDENCY_UNAVAILABLE');
      expect(missing.tool).toBe('search');
    }, 30_000);
  });

  describe('read_page tool', () => {
    test('returns the AI dialect with anchors, nesting metadata and title', async () => {
      const created = await tree({ parents: [null] });
      const [body] = created.pages;
      await writeBody(body, [
        { blockId: 'h1-plan', nodeName: 'heading', attrs: { level: 2 }, text: '季度计划' },
        { blockId: 'p-intro', text: '这里是北极星基准的介绍段落。' },
        { blockId: 'list-todo', nodeName: 'bulletList', children: [
          { blockId: 'item-1', nodeName: 'listItem', children: [{ blockId: 'item-1-p', text: '第一项任务' }] },
          { blockId: 'item-2', nodeName: 'listItem', children: [{ blockId: 'item-2-p', text: '第二项任务' }] },
        ] },
      ]);
      const result = await invokeKnowledgeAgentTool('read_page', { pageId: body.pageId }, await toolContext()) as AgentReadPageToolResult;
      expect(result.pageId).toBe(body.pageId);
      expect(result.markdown).toContain('## 季度计划');
      for (const block of result.blocks) expect(result.markdown).toContain(`{#b:${block.blockId}}`);
      const nested = result.blocks.find((entry) => entry.blockId === 'item-1-p')!;
      expect(nested.parentBlockId).toBe('item-1');
      expect(nested.type).toBe('paragraph');
      expect(result.blocks.find((entry) => entry.blockId === 'list-todo')!.parentBlockId).toBeNull();
    }, 60_000);

    test('range reads return selected blocks in document order and reject out-of-bounds anchors', async () => {
      const created = await tree({ parents: [null] });
      const [body] = created.pages;
      await writeBody(body, [
        { blockId: 'h1-plan', nodeName: 'heading', attrs: { level: 2 }, text: '标题' },
        { blockId: 'p-intro', text: '段落' },
        { blockId: 'item-1-p', text: '列表段' },
      ]);
      const owner = await toolContext();
      const result = await invokeKnowledgeAgentTool('read_page', { pageId: body.pageId, range: ['item-1-p', 'h1-plan'] }, owner) as AgentReadPageToolResult;
      expect(result.markdown).toBeNull();
      expect(result.blocks.map((entry) => entry.blockId)).toEqual(['h1-plan', 'item-1-p']);
      expect(result.blocks.every((entry) => entry.markdown.includes(`{#b:${entry.blockId}}`))).toBe(true);

      // 重复、未知、属于其他页面的锚点一律越界拒绝。
      for (const range of [['h1-plan', 'h1-plan'], ['missing-block'], ['s-para']]) {
        const rejected = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: body.pageId, range }, owner));
        expect(rejected.code).toBe('INVALID_TOOL_RANGE');
        expect(rejected.tool).toBe('read_page');
      }
    }, 60_000);

    test('denials are indistinguishable across missing, unauthorized, recycled and link-only pages', async () => {
      const privateTree = await tree({ parents: [null], defaultAccess: null });
      const [privatePage] = privateTree.pages;
      await grant(privatePage, ownerPrincipal(), 'full');
      await writeBody(privatePage, [{ blockId: 'pv-1', text: '私有内容' }]);
      const recycledTree = await tree({ parents: [null, 0], recycled: [1] });
      await writeBody(recycledTree.pages[1]!, [{ blockId: 'rc-1', text: '已回收' }]);
      const emptyTree = await tree({ parents: [null] });
      const owner = await toolContext();
      const reader = await toolContext(fixture.reader);

      const denied = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: privatePage.pageId }, reader));
      const missing = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: randomUUID() }, owner));
      const recycled = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: recycledTree.pages[1]!.pageId }, owner));
      expect(denied.code).toBe('TARGET_NOT_ACCESSIBLE');
      expect(`${denied.code}:${denied.message}`).toBe(`${missing.code}:${missing.message}`);
      expect(`${denied.code}:${denied.message}`).toBe(`${recycled.code}:${recycled.message}`);

      // 分享链接只授予 link 主体；成员工具路径从不展开它。
      const shared = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) =>
        createAuthorizedShareLink(db, fixture.owner.identity.userId, { knowledgeBaseId: fixture.alpha.id, pageId: privatePage.pageId, level: 'view', expiresAt: null }));
      expect(shared.share.id).toBeTruthy();
      await fixture.drain();
      const viaLink = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: privatePage.pageId }, reader));
      expect(viaLink.code).toBe('TARGET_NOT_ACCESSIBLE');

      const empty = await invokeKnowledgeAgentTool('read_page', { pageId: emptyTree.pages[0]!.pageId }, owner) as AgentReadPageToolResult;
      expect(empty.markdown).toBe('');
      expect(empty.blocks).toEqual([]);
    }, 90_000);

    test('a corrupted authoritative body is reported unreadable, not missing', async () => {
      const created = await tree({ parents: [null] });
      const [body] = created.pages;
      await writeBody(body, [], { corrupt: true });
      const unreadable = await failure(async () => invokeKnowledgeAgentTool('read_page', { pageId: body.pageId }, await toolContext()));
      expect(unreadable.code).toBe('TARGET_NOT_READABLE');
    }, 60_000);
  });

  describe('query_database tool', () => {
    const columns: PropertyDefinition[] = [
      { id: 'c_status', name: '状态', type: 'select', options: [{ id: 'todo', label: '待办', color: 'blue' }, { id: 'done', label: '完成', color: 'green' }] },
      { id: 'c_score', name: '分数', type: 'number' },
    ];

    async function seededDatabase(space: Teamspace, options: { private?: boolean } = {}) {
      const databaseId = randomUUID();
      await withKnowledgeBase(fixture.pool, fixture.alpha.id, async (db) => {
        await createAuthorizedDatabase(db, {
          id: databaseId, knowledgeBaseId: fixture.alpha.id, teamspaceId: space.id, parentId: null, title: '工具数据库', columns,
        }, fixture.owner.identity.userId);
        for (const seed of [
          { title: '行一', properties: { c_status: 'todo', c_score: 30 } },
          { title: '行二', properties: { c_status: 'done', c_score: 20 } },
          { title: '行三', properties: { c_status: 'todo', c_score: 10 } },
        ]) {
          await createAuthorizedRow(db, {
            id: randomUUID(), knowledgeBaseId: fixture.alpha.id, title: seed.title, databaseId, properties: seed.properties,
          }, fixture.owner.identity.userId);
        }
        if (options.private) {
          await replaceAuthorizedPageAcl(db, {
            knowledgeBaseId: fixture.alpha.id, pageId: databaseId, grants: [{ principal: ownerPrincipal(), level: 'full' }],
          });
        }
      });
      await rebuildLatest(databaseId);
      return databaseId;
    }

    test('members filter, sort and paginate rows with product semantics', async () => {
      const space = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: 'Agent 工具库', defaultAccess: 'view' });
      const databaseId = await seededDatabase(space);

      const owner = await toolContext();
      const first = await invokeKnowledgeAgentTool('query_database', {
        databaseId, sort: [{ propertyId: 'c_score', direction: 'desc' }], limit: 2,
      }, owner) as DatabaseRowsPage;
      expect(first.rows.map((row) => row.title)).toEqual(['行一', '行二']);
      expect(first.nextCursor).toBe(first.rows[1]!.pageId);
      const second = await invokeKnowledgeAgentTool('query_database', {
        databaseId, sort: [{ propertyId: 'c_score', direction: 'desc' }], cursor: first.nextCursor, limit: 2,
      }, owner) as DatabaseRowsPage;
      expect(second.rows.map((row) => row.title)).toEqual(['行三']);
      expect(second.nextCursor).toBeNull();

      const filtered = await invokeKnowledgeAgentTool('query_database', {
        databaseId, filters: [{ propertyId: 'c_status', operator: 'eq', value: 'todo' }],
      }, await toolContext(fixture.reader)) as DatabaseRowsPage;
      expect(filtered.rows.map((row) => row.title).sort()).toEqual(['行一', '行三']);
    }, 90_000);

    test('private databases, unknown ids, bad filters, sorts and cursors fail closed', async () => {
      const privateSpace = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '私有工具库', defaultAccess: null });
      const databaseId = await seededDatabase(privateSpace, { private: true });
      const reader = await toolContext(fixture.reader);

      const denied = await failure(async () => invokeKnowledgeAgentTool('query_database', { databaseId }, reader));
      const missing = await failure(async () => invokeKnowledgeAgentTool('query_database', { databaseId: randomUUID() }, await toolContext()));
      expect(denied.code).toBe('TARGET_NOT_ACCESSIBLE');
      expect(`${denied.code}:${denied.message}`).toBe(`${missing.code}:${missing.message}`);

      const owner = await toolContext();
      const badFilter = await failure(async () => invokeKnowledgeAgentTool('query_database', {
        databaseId, filters: [{ propertyId: 'ghost', operator: 'eq', value: 'x' }],
      }, owner));
      expect(badFilter.code).toBe('INVALID_TOOL_QUERY');
      const badSort = await failure(async () => invokeKnowledgeAgentTool('query_database', {
        databaseId, sort: [{ propertyId: 'ghost', direction: 'asc' }],
      }, owner));
      expect(badSort.code).toBe('INVALID_TOOL_QUERY');
      const badCursor = await failure(async () => invokeKnowledgeAgentTool('query_database', { databaseId, cursor: randomUUID() }, owner));
      expect(badCursor.code).toBe('INVALID_TOOL_QUERY');
    }, 90_000);
  });

  describe('list_pages tool', () => {
    test('lists the visible tree, subtrees and root level for members', async () => {
      const space = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '树空间', defaultAccess: 'view' });
      const created = await tree({ teamspace: space, parents: [null, 0, 0, 1] });
      const [root, first, , grandchild] = created.pages;
      const owner = await toolContext();

      const whole = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id }, owner) as AgentListPagesToolResult;
      expect(whole.pages.map((entry) => entry.pageId).sort()).toEqual(created.pages.map((node) => node.pageId).sort());
      expect(new Set(whole.pages.map((entry) => entry.teamspaceId))).toEqual(new Set([space.id]));

      const subtree = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id, parentId: first.pageId }, owner) as AgentListPagesToolResult;
      expect(subtree.pages.map((entry) => entry.pageId)).toEqual([grandchild.pageId]);

      const rootLevel = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id, parentId: null }, owner) as AgentListPagesToolResult;
      expect(rootLevel.pages.map((entry) => entry.pageId)).toEqual([root.pageId]);

      const asReader = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id }, await toolContext(fixture.reader)) as AgentListPagesToolResult;
      expect(asReader.pages).toHaveLength(4);
    }, 90_000);

    test('private subtrees stay invisible and recycled pages never appear', async () => {
      const privateSpace = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '私有树空间', defaultAccess: null });
      const privateTree = await tree({ teamspace: privateSpace, parents: [null, 0] });
      await grant(privateTree.pages[0]!, ownerPrincipal(), 'full');

      const readerView = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: privateSpace.id }, await toolContext(fixture.reader)) as AgentListPagesToolResult;
      expect(readerView.pages).toEqual([]);
      const ownerView = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: privateSpace.id }, await toolContext()) as AgentListPagesToolResult;
      expect(ownerView.pages).toHaveLength(2);

      const denied = await failure(async () => invokeKnowledgeAgentTool('list_pages', { parentId: privateTree.pages[0]!.pageId }, await toolContext(fixture.reader)));
      expect(denied.code).toBe('TARGET_NOT_ACCESSIBLE');

      const space = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '回收树空间', defaultAccess: 'view' });
      const recycled = await tree({ teamspace: space, parents: [null, 0, 0], recycled: [1] });
      const [root, first, second] = recycled.pages;
      const owner = await toolContext();
      const listing = await invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id }, owner) as AgentListPagesToolResult;
      expect(listing.pages.map((entry) => entry.pageId).sort()).toEqual([root.pageId, second.pageId].sort());
      const recycledRoot = await failure(async () => invokeKnowledgeAgentTool('list_pages', { teamspaceId: space.id, parentId: first.pageId }, owner));
      expect(recycledRoot.code).toBe('TARGET_NOT_ACCESSIBLE');
    }, 120_000);
  });

  describe('get_backlinks tool', () => {
    test('exposes member-visible sources with block anchors and filters the rest', async () => {
      const sharedSpace = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '链接目标空间', defaultAccess: 'view' });
      const targetTree = await tree({ teamspace: sharedSpace, parents: [null] });
      const [target] = targetTree.pages;
      const privateSpace = await fixture.organization.createTeamspace(fixture.owner.identity, { knowledgeBaseId: fixture.alphaKnowledgeBase.id, name: '链接来源空间', defaultAccess: null });
      const sourceTree = await tree({ teamspace: privateSpace, parents: [null] });
      const [source] = sourceTree.pages;
      await grant(source, ownerPrincipal(), 'full');
      await writeBody(source, [{
        blockId: 'blk-src-1',
        text: '参见',
        links: [{ target: '目标页', targetBlockId: 'blk-dst-9', pageId: target.pageId }],
      }]);
      await indexPage(source);

      const ownerResult = await invokeKnowledgeAgentTool('get_backlinks', { pageId: target.pageId }, await toolContext()) as AgentGetBacklinksToolResult;
      expect(ownerResult.backlinks).toHaveLength(1);
      expect(ownerResult.backlinks[0]).toMatchObject({ srcPageId: source.pageId, srcBlockId: 'blk-src-1', dstBlockId: 'blk-dst-9' });
      expect(typeof ownerResult.backlinks[0]!.srcTitle).toBe('string');

      const readerResult = await invokeKnowledgeAgentTool('get_backlinks', { pageId: target.pageId }, await toolContext(fixture.reader)) as AgentGetBacklinksToolResult;
      expect(readerResult.backlinks).toEqual([]);

      const denied = await failure(async () => invokeKnowledgeAgentTool('get_backlinks', { pageId: source.pageId }, await toolContext(fixture.reader)));
      expect(denied.code).toBe('TARGET_NOT_ACCESSIBLE');
    }, 120_000);
  });
});

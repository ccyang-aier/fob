import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { collectSuggestions } from '@fob/shared/knowledge/schema/suggestions';
import { principal } from '@fob/shared/knowledge/contracts';
import { docState, page } from '../../../../platform/database/resources/schema';
import { withKnowledgeBase } from '../../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../../permissions/mutations';
import { createPermissionsFixture, until, type PermissionsFixture } from '../../permissions/permissions-test-fixture';
import { createPageCollaborationListener } from '../../collaboration/page-collaboration-bun';
import { yStateToProseMirrorDoc } from '../../import-export/y-encoding';
import { knowledgeAgentWriteTools } from './write';
import { invokeKnowledgeAgentTool } from '.';
import type { KnowledgeAgentWriteContext } from './types';

const writeTool = (name: string) => knowledgeAgentWriteTools.find((tool) => tool.name === name)!;
const TASK_ID = '33333333-3333-4333-8333-333333333333';

/** Agent writes are reviewable suggestions over the real collaboration host. */
describe('agent suggestion write tools', () => {
  let fixture: PermissionsFixture;
  let listener: ReturnType<typeof createPageCollaborationListener>;
  let context: KnowledgeAgentWriteContext;

  beforeAll(async () => {
    fixture = await createPermissionsFixture();
    listener = createPageCollaborationListener(
      { authenticator: fixture.authenticator, pool: fixture.pool },
      { persistence: { debounceMs: 120, maxDebounceMs: 400 } },
    );
    context = { pool: fixture.pool, authority: undefined as never, agent: { taskId: TASK_ID }, hocuspocus: listener.hocuspocus };
  });
  afterAll(async () => {
    expect(fixture.errors).toEqual([]);
    await listener.close();
    await fixture.close();
  });
  beforeEach(async () => {
    await fixture.resetJobs();
  });

  async function seedBody(scope: { knowledgeBaseId: string; pageId: string }, markdown: string) {
    const { prosemirrorDocToYDoc } = await import('../../import-export/y-encoding');
    const { createMarkdownPipeline } = await import('@fob/shared/knowledge/markdown');
    const { repairBlockIds } = await import('@fob/shared/knowledge/schema');
    const document = repairBlockIds(createMarkdownPipeline().parse(markdown)).doc;
    const blocks: import('@tiptap/pm/model').Node[] = [];
    document.forEach((block) => blocks.push(block));
    const encoded = prosemirrorDocToYDoc(document.type.schema.topNodeType.createChecked(null, blocks));
    await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, async (db) => {
      await db.insert(docState).values({ ...scope, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) });
    });
    return encoded;
  }

  async function currentSuggestions(scope: { knowledgeBaseId: string; pageId: string }) {
    const [row] = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, scope.pageId)));
    const document = row ? yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema) : null;
    return document ? collectSuggestions(document) : [];
  }

  test('insert proposes annotated blocks with fresh ids at the anchor', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await seedBody(scope, '# 标题一\n\n第一段内容');
    await fixture.drain();
    const authority = await createTokenAuthority();

    const firstBlockId = await blockIdAt(scope, 0);
    const result = await writeTool('insert').execute({ ...scope, afterBlockId: firstBlockId, markdown: '## 建议的新标题\n\n建议正文' }, { ...context, authority });
    const { suggestionId } = result as { suggestionId: string };

    await until(async () => (await currentSuggestions(scope)).length > 0);
    const suggestions = await currentSuggestions(scope);
    expect(suggestions.length).toBeGreaterThan(0);
    const inserted = suggestions.at(-1)!;
    expect(inserted.suggestionId).toBe(suggestionId);
    expect(inserted.author).toBe(`agent:${TASK_ID}`);
    // 建议块获得新 blockId(非空且不与锚点相同)
    const newBlockId = await suggestedBlockId(scope, suggestionId);
    expect(newBlockId).toBeTruthy();
    expect(newBlockId).not.toBe(firstBlockId);
  });

  test('replace marks the original deleted and inserts alongside', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await seedBody(scope, '旧标题\n\n旧正文');
    await fixture.drain();
    const authority = await createTokenAuthority();

    const target = await blockIdAt(scope, 0);
    const { suggestionId } = await writeTool('replace').execute({ ...scope, blockId: target, markdown: '全新的替换内容' }, { ...context, authority }) as { suggestionId: string };
    await until(async () => (await currentSuggestions(scope)).some((item) => item.suggestionId === suggestionId));

    const document = await currentDocument(scope);
    const summary = (await currentSuggestions(scope)).find((item) => item.suggestionId === suggestionId)!;
    // 同一 suggestionId 覆盖删除与插入两种备选,原文与替换并存
    expect(summary.ranges.some((range) => range.type === 'suggestion_delete')).toBe(true);
    expect(summary.ranges.some((range) => range.type === 'suggestion_insert')).toBe(true);
    expect(document.textContent).toContain('旧标题');
    expect(document.textContent).toContain('全新的替换内容');
  });

  test('view-level principals and foreign actors are rejected indistinguishably', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[3].pageId };
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'view' }] }));
    await seedBody(scope, '仅可读正文');
    await fixture.drain();
    const viewer = await createTokenAuthority();

    await expect(writeTool('delete').execute({ ...scope, blockId: 'b1' }, { ...context, authority: viewer })).rejects.toMatchObject({ code: 'TARGET_NOT_ACCESSIBLE' });
    await expect(writeTool('insert').execute({ ...scope, afterBlockId: null, markdown: 'x' }, { ...context, authority: viewer })).rejects.toMatchObject({ code: 'TARGET_NOT_ACCESSIBLE' });
  });

  test('create_page and update_properties run through the tree service under authorization', async () => {
    const { pages, teamspace } = await fixture.tree({ defaultAccess: null });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await fixture.drain();
    const authority = await createTokenAuthority();

    const created = await writeTool('create_page').execute({
      knowledgeBaseId: fixture.alpha.id, teamspaceId: teamspace.id, parentId: pages[0].pageId, title: '代理新建页', kind: 'doc',
    }, { ...context, authority }) as { pageId: string };
    const [row] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select().from(page).where(eq(page.id, created.pageId)));
    expect(row?.title).toBe('代理新建页');
    expect(row?.createdBy).toBe(authority.userId);
    // 建页围栏后子树 ACL 处于 pending;重算落地后才能对其实施属性写。
    await fixture.drain();

    await writeTool('update_properties').execute({ knowledgeBaseId: fixture.alpha.id, pageId: created.pageId, patch: { title: '更新后的标题' } }, { ...context, authority });
    const [renamed] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => db.select().from(page).where(eq(page.id, created.pageId)));
    expect(renamed?.title).toBe('更新后的标题');
  });

  test('the headless fallback writes doc_state and a doc.changed event with the agent actor', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[1].pageId };
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await seedBody(scope, '无宿主正文');
    await fixture.drain();
    const authority = await createTokenAuthority();
    const headless: KnowledgeAgentWriteContext = { pool: fixture.pool, authority, agent: { taskId: TASK_ID } };

    await writeTool('delete').execute({ ...scope, blockId: await blockIdAt(scope, 0) }, headless);
    const events = await fixture.server.database.admin.query(
      "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='doc.changed' AND payload->>'pageId'=$2", [scope.knowledgeBaseId, scope.pageId]);
    expect(events.rows.length).toBeGreaterThan(0);
    expect((events.rows.at(-1) as { payload: { actor: unknown } }).payload.actor).toEqual({ kind: 'agent', userId: authority.userId, taskId: TASK_ID });
    expect((await currentSuggestions(scope)).length).toBeGreaterThan(0);
  });

  test('invoke dispatches write tools by name with the same guard', async () => {
    const { pages } = await fixture.tree({ defaultAccess: null });
    const scope = { knowledgeBaseId: fixture.alpha.id, pageId: pages[2].pageId };
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: fixture.alpha.id, pageId: pages[0].pageId, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'edit' }] }));
    await seedBody(scope, '分发正文');
    await fixture.drain();
    const bearer = await fixture.createToken(fixture.reader, ['read']);
    const readOnly = await fixture.authenticator.authenticate(new Request(`${fixture.server.origin}/`, { headers: { authorization: bearer, origin: fixture.server.webOrigin } }), fixture.alpha.id, ['read']);

    await expect(invokeKnowledgeAgentTool('delete', { ...scope, blockId: 'b1' }, { ...context, authority: readOnly })).rejects.toMatchObject({ code: 'INSUFFICIENT_SCOPE' });
  });

  // helpers
  async function createTokenAuthority() {
    // 会话凭证(读写)——经 fixture 会话 Cookie 直接构造请求上下文
    const bearer = await fixture.createToken(fixture.reader, ['read', 'write']);
    return fixture.authenticator.authenticate(new Request(`${fixture.server.origin}/`, { headers: { authorization: bearer, origin: fixture.server.webOrigin } }), fixture.alpha.id, ['read', 'write']);
  }
  async function currentDocument(scope: { knowledgeBaseId: string; pageId: string }) {
    const [row] = await withKnowledgeBase(fixture.pool, scope.knowledgeBaseId, (db) => db.select({ state: docState.state }).from(docState).where(eq(docState.pageId, scope.pageId)));
    return yStateToProseMirrorDoc(new Uint8Array(row.state), knowledgeSchema)!;
  }
  async function blockIdAt(scope: { knowledgeBaseId: string; pageId: string }, index: number): Promise<string> {
    const document = await currentDocument(scope);
    let seen = -1;
    let found = '';
    document.descendants((node) => {
      if (found || !node.type.spec.attrs?.blockId) return;
      seen += 1;
      if (seen === index) found = node.attrs.blockId as string;
    });
    return found;
  }
  async function suggestedBlockId(scope: { knowledgeBaseId: string; pageId: string }, suggestionId: string): Promise<string> {
    const document = await currentDocument(scope);
    let found = '';
    document.descendants((node) => {
      if (found) return;
      const annotations = (node.attrs.annotations as { type: string; attrs: { suggestionId: string } }[] | null) ?? [];
      if (annotations.some((item) => item.type === 'suggestion_insert' && item.attrs.suggestionId === suggestionId) && node.type.spec.attrs?.blockId) {
        found = node.attrs.blockId as string;
      }
    });
    return found;
  }
});

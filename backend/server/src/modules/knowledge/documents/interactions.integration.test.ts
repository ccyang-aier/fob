import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { beijingDay } from '@fob/shared/rewards';
import type { PageScope } from '@fob/shared/knowledge/contracts';
import { createPermissionsFixture, type PermissionsFixture, type PermissionTestActor } from '../permissions/permissions-test-fixture';
import { withFobAccount } from '../../../platform/database/resources/transaction';
import { createRewardsService } from '../../rewards';
import { createDocumentCollaborationRoutes } from './http';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture({ mount(app, deps) { app.route('/', createDocumentCollaborationRoutes({ ...deps, publicationSecret: 'interaction-test-publication-secret' })); } }); }, 60000);
afterAll(async () => { await fixture?.close(); }, 30000);
beforeEach(async () => { await fixture.resetJobs(); await fixture.admin.query('DELETE FROM resources.coffee_transfer; DELETE FROM resources.coffee_ledger; DELETE FROM resources.document_like'); });
const base = (scope: PageScope) => `/api/knowledge/${scope.knowledgeBaseId}/pages/${scope.pageId}/collaboration`;
function request(scope: PageScope, actor: PermissionTestActor | null, path = '/interactions', body?: unknown) {
  return fetch(`${fixture.server.origin}${base(scope)}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { origin: fixture.server.webOrigin, ...(actor ? { cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(path === '/coffee' && actor ? { accountId:actor.identity.userId,...body as object } : body) });
}
async function awards(userId: string, count: number) {
  const now = new Date((await fixture.admin.query('SELECT clock_timestamp() AS now')).rows[0].now).getTime();
  for (let index = 0; index < count; index++) {
    const at = new Date(now - index * 86400000);
    await fixture.admin.query('INSERT INTO resources.coffee_ledger(id,user_id,day,amount,kind,created_at) VALUES ($1,$2,$3,1,\'daily_check_in\',$4)', [randomUUID(),userId,beijingDay(at),at]);
  }
}
const balance = async (actor: PermissionTestActor) => (await createRewardsService(fixture.pool).summary(actor.identity)).balance;

test('document likes persist, deduplicate, toggle and respect live page ACL', async () => {
  const { root } = await fixture.tree(); await fixture.drain();
  for (let index = 0; index < 3; index++) expect(await (await request(root,fixture.reader,'/likes',{ liked:true })).json()).toMatchObject({ liked:true,likes:1 });
  expect(await (await request(root,fixture.owner,'/likes',{ liked:true })).json()).toMatchObject({ liked:true,likes:2 });
  expect(await (await request(root,fixture.reader)).json()).toMatchObject({ liked:true,likes:2 });
  expect(await (await request(root,fixture.reader,'/likes',{ liked:false })).json()).toMatchObject({ liked:false,likes:1 });
  const hidden = await fixture.tree({ defaultAccess:null }); await fixture.drain();
  expect((await request(hidden.root,fixture.reader,'/likes',{ liked:true })).status).toBe(403);
  expect([401,403]).toContain((await request(root,fixture.foreign,'/likes',{ liked:true })).status);
  expect((await request(root,null,'/likes',{ liked:true })).status).toBe(401);
});

test('coffee gifts transfer the selected quantity once, including concurrent retries, and reject invalid spending', async () => {
  const { root } = await fixture.tree(); await fixture.drain();
  await awards(fixture.reader.identity.userId,5);
  const input = { requestId:randomUUID(),amount:2 };
  const responses = await Promise.all(Array.from({ length:6 },()=>request(root,fixture.reader,'/coffee',input)));
  expect(responses.map(response=>response.status)).toEqual(Array(6).fill(200));
  for (const response of responses) expect(await response.json()).toMatchObject({ ...input,balance:3 });
  expect(await balance(fixture.reader)).toBe(3); expect(await balance(fixture.owner)).toBe(2);
  const senderLedger = await createRewardsService(fixture.pool).ledger(fixture.reader.identity,{ limit:2 });
  expect(senderLedger.items[0]).toMatchObject({ amount:-2,kind:'coffee_sent' });
  const recipientLedger = await createRewardsService(fixture.pool).ledger(fixture.owner.identity);
  expect(recipientLedger.items[0]).toMatchObject({ amount:2,kind:'coffee_received' });
  expect(Number((await fixture.admin.query('SELECT count(*) FROM resources.coffee_transfer')).rows[0].count)).toBe(1);
  expect(await (await request(root,fixture.reader)).json()).toMatchObject({ coffeeTotal:2,canGift:true,recipient:{ id:fixture.owner.identity.userId } });
  expect((await request(root,fixture.reader,'/coffee',{ ...input,amount:1 })).status).toBe(409);
  const insufficient = await request(root,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:4 });
  expect(insufficient.status).toBe(409); expect(await insufficient.json()).toMatchObject({ code:'INSUFFICIENT_COFFEE' });
  for (const amount of [0,-1,1.5,1001]) expect((await request(root,fixture.reader,'/coffee',{ requestId:randomUUID(),amount })).status).toBe(400);
  expect((await request(root,fixture.owner,'/coffee',{ requestId:randomUUID(),amount:1 })).status).toBe(400);
  expect((await request(root,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:1,recipientId:fixture.foreign.identity.userId })).status).toBe(400);
  expect((await request(root,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:1,accountId:fixture.owner.identity.userId })).status).toBe(409);
  expect(await balance(fixture.reader)).toBe(3);
  await expect(withFobAccount(fixture.pool,fixture.reader.identity.sessionId,async db=>{
    await db.execute(sql`SELECT set_config('app.knowledge_base_id',${root.knowledgeBaseId},true)`);
    return db.execute(sql`INSERT INTO resources.coffee_transfer(id,request_id,knowledge_base_id,page_id,sender_id,recipient_id,amount)
      VALUES(${randomUUID()},${randomUUID()},${root.knowledgeBaseId},${root.pageId},${fixture.reader.identity.userId},${fixture.owner.identity.userId},4)`);
  })).rejects.toMatchObject({cause:{code:'23514'}});
});

test('concurrent gifts in different libraries cannot overspend the same account', async () => {
  const alpha = await fixture.tree(); const beta = await fixture.tree({ resource:'beta' }); await fixture.drain();
  await fixture.admin.query("INSERT INTO resources.knowledge_base_member(knowledge_base_id,user_id,role) VALUES($1,$2,'member')",[fixture.beta.id,fixture.reader.identity.userId]);
  await awards(fixture.reader.identity.userId,3);
  const responses = await Promise.all([alpha.root,beta.root].map(scope=>request(scope,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:2 })));
  expect(responses.map(response=>response.status).sort()).toEqual([200,409]);
  expect(await balance(fixture.reader)).toBe(1);
  expect(await balance(fixture.owner)+await balance(fixture.foreign)).toBe(2);
});

test('private pages reject gifts; immutable account transfers survive deletion of their source page', async () => {
  const privateTree = await fixture.tree({ defaultAccess:null }); const publicTree = await fixture.tree(); await fixture.drain();
  await awards(fixture.reader.identity.userId,3);
  expect((await request(privateTree.root,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:1 })).status).toBe(403);
  const leaf = publicTree.pages[2]!;
  expect((await request(leaf,fixture.reader,'/coffee',{ requestId:randomUUID(),amount:2 })).status).toBe(200);
  const foreignRows = await withFobAccount(fixture.pool,fixture.foreign.identity.sessionId,db=>db.execute(sql`SELECT * FROM resources.coffee_transfer`));
  expect(foreignRows.rows).toHaveLength(0);
  for (const statement of [sql`UPDATE resources.coffee_transfer SET amount=1 RETURNING id`,sql`DELETE FROM resources.coffee_transfer RETURNING id`]) {
    expect((await withFobAccount(fixture.pool,fixture.reader.identity.sessionId,db=>db.execute(statement))).rows).toHaveLength(0);
  }
  await fixture.admin.query('DELETE FROM resources.page WHERE knowledge_base_id=$1 AND id=$2',[leaf.knowledgeBaseId,leaf.pageId]);
  expect(await balance(fixture.reader)).toBe(1); expect(await balance(fixture.owner)).toBe(2);
  expect((await request(leaf,fixture.reader)).status).toBe(403);
});

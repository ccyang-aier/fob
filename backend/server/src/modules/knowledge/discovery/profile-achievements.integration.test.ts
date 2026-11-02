import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and,eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { personalProfileSchema, profileMedalRecipientsSchema } from '@fob/shared/knowledge/contracts';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { documentVisit,page,shareLink } from '../../../platform/database/resources/schema';
import { createKnowledgeDiscoveryRoutes } from './http';

let fixture: PermissionsFixture;
let visible: string, hidden: string;
const earnedAt = '2021-06-01T02:03:04.000Z';
beforeAll(async () => {
  fixture=await createPermissionsFixture({ mount(app,deps) { app.route('/',createKnowledgeDiscoveryRoutes({ ...deps,trustedOrigins:deps.auth.options.trustedOrigins as string[] })); } });
  const tree=await fixture.tree({ defaultAccess:'view',parents:[null,0],breaks:[1] });
  visible=tree.root.pageId; hidden=tree.pages[1].pageId;
  await fixture.drain();
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,async db => {
    await db.update(page).set({ createdBy:fixture.reader.identity.userId,createdAt:new Date(earnedAt) }).where(and(eq(page.knowledgeBaseId,fixture.alpha.id),eq(page.id,visible)));
    await db.update(page).set({ createdBy:fixture.reader.identity.userId,createdAt:new Date('2020-01-01') }).where(and(eq(page.knowledgeBaseId,fixture.alpha.id),eq(page.id,hidden)));
  });
},60_000);
afterAll(async () => { await fixture?.close(); },30_000);

function request(path:string,body?:unknown,actor=fixture.reader,origin=fixture.server.webOrigin,kb=fixture.alpha.id) {
  return fetch(`${fixture.server.origin}/api/knowledge/${kb}/discovery/profile${path}`,{
    method:body===undefined ? 'GET':'POST',headers:{ cookie:actor.cookie,origin,'content-type':'application/json' },
    ...(body===undefined ? {}:{ body:JSON.stringify(body) }),
  });
}

test('milestone dates and recipient records use real visible documents, not first query time or hidden history',async () => {
  const response=await request(''); expect(response.status).toBe(200);
  const data=personalProfileSchema.parse(await response.json());
  expect(data.medals).toEqual([{ id:'gardener',earnedAt }]);
  const winners=await request('/medals/gardener'); expect(winners.status).toBe(200);
  const list=profileMedalRecipientsSchema.parse(await winners.json());
  expect(list.recipients.find(person => person.userId===fixture.reader.identity.userId)?.earnedAt).toBe(earnedAt);
  expect(list.recipients.some(person => person.userId===fixture.foreign.identity.userId)).toBe(false);
  expect((await request('/medals/not-a-medal')).status).toBe(400);
  expect((await request('/medals/gardener?offset=-1')).status).toBe(400);
  expect((await request('/medals/gardener',undefined,fixture.foreign)).status).toBe(401);
  expect((await request('/medals/gardener',undefined,fixture.reader,fixture.server.webOrigin,fixture.beta.id)).status).toBe(401);
});

test('learning is bounded by server elapsed time, deduplicates simultaneous tabs, and excludes hidden pages',async () => {
  const start=await request('/learning',{ pageId:visible,seconds:0 }); expect(start.status).toBe(200);
  expect(await start.json()).toEqual({ seconds:0 });
  await fixture.admin.query("UPDATE resources.document_visit SET study_heartbeat_at=clock_timestamp()-interval '15 seconds' WHERE knowledge_base_id=$1 AND user_id=$2",[fixture.alpha.id,fixture.reader.identity.userId]);
  const results=await Promise.all([request('/learning',{ pageId:visible,seconds:15 }),request('/learning',{ pageId:visible,seconds:15 })]);
  expect(results.map(result => result.status)).toEqual([200,200]);
  const credits=await Promise.all(results.map(result => result.json() as Promise<{ seconds:number }>));
  expect(credits.reduce((sum,result) => sum+result.seconds,0)).toBe(15);
  expect((await request('/learning',{ pageId:visible,seconds:9999 })).status).toBe(400);
  expect((await request('/learning',{ pageId:hidden,seconds:15 })).status).toBe(403);
  expect((await request('/learning',{ pageId:visible,seconds:15 },fixture.reader,'https://untrusted.example')).status).toBe(403);
  await fixture.admin.query("UPDATE resources.document_visit SET study_heartbeat_at=clock_timestamp()-interval '2 hours' WHERE knowledge_base_id=$1 AND user_id=$2",[fixture.alpha.id,fixture.reader.identity.userId]);
  const resumed=await request('/learning',{ pageId:visible,seconds:15 }); expect(await resumed.json()).toEqual({ seconds:0 });
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,async db => {
    await db.update(documentVisit).set({ studySeconds:125 }).where(and(eq(documentVisit.knowledgeBaseId,fixture.alpha.id),eq(documentVisit.pageId,visible),eq(documentVisit.userId,fixture.reader.identity.userId)));
    await db.insert(documentVisit).values({ knowledgeBaseId:fixture.alpha.id,pageId:hidden,userId:fixture.reader.identity.userId,studySeconds:3600 });
  });
  const profile=personalProfileSchema.parse(await (await request('')).json());
  expect(profile.learningMinutes).toBe(2);
});

test('seven consecutive activity days preserve the actual seventh-day award after a long inactive gap',async () => {
  const tree=await fixture.tree({ defaultAccess:'view',parents:[null,0,0,0,0,0,0] }); await fixture.drain();
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,async db => {
    for (const [index,scope] of tree.pages.entries()) await db.update(page).set({ createdBy:fixture.reader.identity.userId,createdAt:new Date(`2022-02-${String(index+1).padStart(2,'0')}T04:05:06Z`) }).where(and(eq(page.knowledgeBaseId,fixture.alpha.id),eq(page.id,scope.pageId)));
  });
  const data=personalProfileSchema.parse(await (await request('')).json());
  expect(data.medals.find(award => award.id==='creator')?.earnedAt).toBe('2022-02-07T04:05:06.000Z');
  const list=profileMedalRecipientsSchema.parse(await (await request('/medals/creator')).json());
  expect(list.recipients.find(person => person.userId===fixture.reader.identity.userId)?.earnedAt).toBe('2022-02-07T04:05:06.000Z');
});

test('sharing uses the actual live publication timestamp and removes revoked award projections',async () => {
  const id=randomUUID(), at='2023-03-04T05:06:07.000Z';
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => db.insert(shareLink).values({ knowledgeBaseId:fixture.alpha.id,id,pageId:visible,tokenHash:'a'.repeat(64),createdBy:fixture.reader.identity.userId,createdAt:new Date(at) }));
  const data=personalProfileSchema.parse(await (await request('')).json());
  expect(data.medals.find(award => award.id==='sharing')?.earnedAt).toBe(at);
  const list=profileMedalRecipientsSchema.parse(await (await request('/medals/sharing')).json());
  expect(list.recipients.find(person => person.userId===fixture.reader.identity.userId)?.earnedAt).toBe(at);
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => db.update(shareLink).set({ revokedAt:new Date() }).where(and(eq(shareLink.knowledgeBaseId,fixture.alpha.id),eq(shareLink.id,id))));
  expect(personalProfileSchema.parse(await (await request('')).json()).medals.some(award => award.id==='sharing')).toBe(false);
});

test('stale ACLs fail closed for learning totals and medal recipients',async () => {
  await fixture.admin.query('UPDATE resources.page SET acl_revision=acl_revision+1 WHERE knowledge_base_id=$1',[fixture.alpha.id]);
  const data=personalProfileSchema.parse(await (await request('')).json());
  expect(data.learningMinutes).toBe(0); expect(data.medals).toEqual([]);
  const list=profileMedalRecipientsSchema.parse(await (await request('/medals/gardener')).json());
  expect(list.recipients).toEqual([]);
  expect((await request('/learning',{ pageId:visible,seconds:15 })).status).toBe(403);
});

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { personalProfileSchema } from '@fob/shared/knowledge/contracts';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { page, comment, commentThread, commentLike, knowledgeSubscription } from '../../../platform/database/resources/schema';
import { personalProfile } from './personal-profile';
import { createKnowledgeDiscoveryRoutes } from './http';

let fixture: PermissionsFixture;
beforeAll(async () => {
  fixture = await createPermissionsFixture({ mount(app, deps) { app.route('/', createKnowledgeDiscoveryRoutes({ ...deps, trustedOrigins: deps.auth.options.trustedOrigins as string[] })); } });
}, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);

test('profile projects real personal activity and never includes another author or inaccessible content', async () => {
  const tree = await fixture.tree({ defaultAccess: 'view', parents: [null,0], breaks: [1] });
  await fixture.drain();
  const kb = fixture.alpha.id, user = fixture.reader.identity.userId;
  const threadId = randomUUID(), commentId = randomUUID(), otherCommentId = randomUUID();
  const privateThreadId = randomUUID(), privateCommentId = randomUUID();
  await withKnowledgeBase(fixture.pool,kb,async db => {
    await db.update(page).set({ title: 'Visible personal document', createdBy: user }).where(and(eq(page.knowledgeBaseId,kb),eq(page.id,tree.root.pageId)));
    await db.insert(commentThread).values([
      { knowledgeBaseId: kb,id: threadId,pageId: tree.root.pageId },
      { knowledgeBaseId: kb,id: privateThreadId,pageId: tree.pages[1]!.pageId },
    ]);
    await db.insert(comment).values([
      { knowledgeBaseId: kb,id: commentId,threadId,authorId: user,bodyMd: 'A real personal comment' },
      { knowledgeBaseId: kb,id: otherCommentId,threadId,authorId: fixture.owner.identity.userId,bodyMd: 'A visible comment by another person' },
      { knowledgeBaseId: kb,id: privateCommentId,threadId: privateThreadId,authorId: fixture.owner.identity.userId,bodyMd: 'An inaccessible comment' },
    ]);
    await db.insert(commentLike).values([
      { knowledgeBaseId: kb,commentId,userId: fixture.owner.identity.userId },
      { knowledgeBaseId: kb,commentId: otherCommentId,userId: user },
      { knowledgeBaseId: kb,commentId: privateCommentId,userId: user },
    ]);
    await db.insert(knowledgeSubscription).values({ knowledgeBaseId: kb,id: randomUUID(),userId: user,pageId: tree.root.pageId });
  });
  const request = new Request(`${fixture.server.origin}/api/knowledge/${kb}/discovery/profile`, { headers: { cookie: fixture.reader.cookie } });
  const authority = await fixture.authenticator.authenticate(request,kb,['read']);
  const data = await withKnowledgeBase(fixture.pool,kb,db => personalProfile(db,authority,{ starred: `${tree.root.pageId},${tree.pages[1]!.pageId}` }));
  personalProfileSchema.parse(data);
  expect(data.documentTotal).toBe(1);
  expect(data.documents.map(item => item.id)).toEqual([tree.root.pageId]);
  expect(data.saved.map(item => item.id)).toEqual([tree.root.pageId]);
  expect(data.activities.map(item => item.kind).sort()).toEqual(['commented','created','liked','subscribed']);
  expect(data.activities.every(item => item.targetId === tree.root.pageId)).toBe(true);
  expect(data.receivedLikes).toBe(1);
  expect(data.dayCounts).toEqual({ created: 1,commented: 1 });
  expect(data.calendar.reduce((sum,day) => sum+day.count,0)).toBe(4);
  expect(data.calendar[0]?.counts).toEqual({ created: 1,commented: 1,liked: 1,subscribed: 1 });
  const response = await fetch(request.url,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.reader.cookie } });
  expect(response.status).toBe(200);
  expect(personalProfileSchema.parse(await response.json()).documentTotal).toBe(1);
},30_000);

test('profile validates date and pagination, cannot select another user, and requires knowledge membership', async () => {
  const base = `${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/discovery/profile`;
  for (const query of ['day=2026-02-30','day=oops','documentOffset=-1','activityOffset=1.2','starred=invalid']) {
    const response = await fetch(`${base}?${query}`,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.reader.cookie } });
    expect(response.status).toBe(400);
  }
  const foreign = await fetch(base,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.foreign.cookie } });
  expect([401,403,404]).toContain(foreign.status);
  const own = await fetch(`${base}?userId=${fixture.owner.identity.userId}&day=2020-01-01`,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.reader.cookie } });
  expect(own.status).toBe(200);
  const data = personalProfileSchema.parse(await own.json());
  expect(data.documentTotal).toBe(1);
  expect(data.activities).toEqual([]);
  expect(data.dayCounts).toEqual({ created: 0,commented: 0 });
});

test('document and event pagination keep full-day counts, and search runs before pagination', async () => {
  const tree = await fixture.tree({ parents: [null,...Array.from({ length: 44 },() => 0)],defaultAccess: 'view' });
  await fixture.drain();
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => db.update(page).set({ title: 'Unique last-page result' }).where(and(eq(page.knowledgeBaseId,fixture.alpha.id),eq(page.id,tree.pages.at(-1)!.pageId))));
  const authority = await fixture.authenticator.authenticate(new Request(`${fixture.server.origin}/`,{ headers: { cookie: fixture.owner.cookie } }),fixture.alpha.id,['read']);
  const first = await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => personalProfile(db,authority,{}));
  expect(first.documents).toHaveLength(40);
  expect(first.activities).toHaveLength(40);
  expect(first.nextDocumentOffset).toBe(40);
  expect(first.dayCounts.created).toBeGreaterThanOrEqual(45);
  const last = await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => personalProfile(db,authority,{ documentOffset: 40,activityOffset: 40 }));
  expect(last.documents.length).toBeGreaterThan(0);
  expect(last.nextDocumentOffset).toBeNull();
  expect(new Set([...first.documents,...last.documents].map(doc => doc.id)).size).toBe(first.documentTotal);
  expect(last.dayCounts).toEqual(first.dayCounts);
  expect(last.calendar).toEqual(first.calendar);
  const documentPage = await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => personalProfile(db,authority,{ documentOffset: 40 }));
  expect(documentPage.documents.map(item => item.id)).toEqual(last.documents.map(item => item.id));
  expect(documentPage.activities.map(item => item.id)).toEqual(first.activities.map(item => item.id));
  expect(first.calendar.every(day => Object.values(day.counts).reduce((sum,count) => sum+count,0) === day.count)).toBe(true);
  const matching = await withKnowledgeBase(fixture.pool,fixture.alpha.id,db => personalProfile(db,authority,{ q: 'Unique last-page result' }));
  expect(matching.documents.map(doc => doc.id)).toEqual([tree.pages.at(-1)!.pageId]);
  expect(matching.documentTotal).toBe(first.documentTotal);
},30_000);

test('the annual calendar includes older activity through day 364 and excludes day 365', async () => {
  const tree = await fixture.tree({ parents: [null,0,0],defaultAccess: 'view' });
  await fixture.drain();
  const dates = [300,364,365].map(days => new Date(Date.now()-days*86_400_000));
  const day = (date: Date) => new Intl.DateTimeFormat('en-CA',{ timeZone: 'Asia/Shanghai',year: 'numeric',month: '2-digit',day: '2-digit' }).format(date);
  await withKnowledgeBase(fixture.pool,fixture.alpha.id,async db => {
    for (const [index,scope] of tree.pages.entries()) {
      await db.update(page).set({ createdBy: fixture.reader.identity.userId,createdAt: dates[index]! }).where(and(eq(page.knowledgeBaseId,fixture.alpha.id),eq(page.id,scope.pageId)));
    }
  });
  const response = await fetch(`${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/discovery/profile`,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.reader.cookie } });
  expect(response.status).toBe(200);
  const data = personalProfileSchema.parse(await response.json());
  expect(data.calendar.find(item => item.date === day(dates[0]!))?.count).toBe(1);
  expect(data.calendar.find(item => item.date === day(dates[1]!))?.count).toBe(1);
  expect(data.calendar.some(item => item.date === day(dates[2]!))).toBe(false);
},30_000);

test('stale ACL materializations cannot leak titles, counts, folders, saved items or history', async () => {
  await fixture.admin.query('UPDATE resources.page SET acl_revision=acl_revision+1 WHERE knowledge_base_id=$1',[fixture.alpha.id]);
  const response = await fetch(`${fixture.server.origin}/api/knowledge/${fixture.alpha.id}/discovery/profile`,{ headers: { origin: fixture.server.webOrigin,cookie: fixture.reader.cookie } });
  expect(response.status).toBe(200);
  const data = personalProfileSchema.parse(await response.json());
  expect(data.documentTotal).toBe(0);
  expect(data.documents).toEqual([]);
  expect(data.folders).toEqual([]);
  expect(data.saved).toEqual([]);
  expect(data.activities).toEqual([]);
  expect(data.calendar).toEqual([]);
  expect(data.receivedLikes).toBe(0);
});

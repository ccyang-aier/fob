import { afterAll, beforeAll, expect, test } from 'bun:test';
import { and, eq } from 'drizzle-orm';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { principal } from '@fob/shared/knowledge/contracts';
import { createPermissionsFixture, type PermissionsFixture } from '../permissions/permissions-test-fixture';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { docState, page, pageAcl } from '../../../platform/database/resources/schema';
import { prosemirrorDocToYDoc } from '../import-export/y-encoding';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';

let fixture: PermissionsFixture;
beforeAll(async () => { fixture = await createPermissionsFixture(); }, 60_000);
afterAll(async () => { await fixture?.close(); }, 30_000);
const owner = () => fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
const reader = () => fixture.apiClient({ cookie: fixture.reader.cookie, origin: fixture.server.webOrigin });

test('cross-folder transfer preserves subtree identity, body and explicit ACL while applying destination inheritance', async () => {
  const source = await fixture.tree({ defaultAccess: 'view', breaks: [2] }), destination = await fixture.tree({ defaultAccess: null });
  const moving = source.pages[1]!, child = source.pages[2]!;
  const encoded = prosemirrorDocToYDoc(knowledgeSchema.node('doc', null, [knowledgeSchema.node('paragraph', { blockId: 'stable-content' }, [knowledgeSchema.text('Keep this content')])]));
  try {
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, async db => {
      await db.insert(docState).values({ ...moving, state: encoded.state, stateVector: encoded.stateVector });
      await db.insert(pageAcl).values({ ...moving, principal: principal('user', fixture.owner.identity.userId), level: 'full', inherited: false });
      await db.insert(pageAcl).values({ ...child, principal: principal('user', fixture.reader.identity.userId), level: 'view', inherited: false });
    });
    await fixture.drain();
    const placed = await owner().page.transfer.mutate({ knowledgeBaseId: moving.knowledgeBaseId, pageId: moving.pageId, targetTeamspaceId: destination.teamspace.id });
    expect(placed).toMatchObject({ pageId: moving.pageId, parentId: null, teamspaceId: destination.teamspace.id, path: moving.pageId.replaceAll('-', '_') });
    const rows = await owner().page.list.query({ knowledgeBaseId: fixture.alpha.id });
    expect(rows.find(row => row.id === moving.pageId)?.teamspaceId).toBe(destination.teamspace.id);
    const [movedChild] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select().from(page).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, child.pageId))));
    expect(movedChild).toMatchObject({ teamspaceId: destination.teamspace.id, parentId: moving.pageId, inheritsPermissions: false, path: `${placed.path}.${child.pageId.replaceAll('-', '_')}` });
    expect(rows.find(row => row.id === source.pages[3]!.pageId)?.teamspaceId).toBe(source.teamspace.id);
    const visible = await reader().page.list.query({ knowledgeBaseId: fixture.alpha.id });
    expect(visible.some(row => row.id === moving.pageId)).toBe(false);
    expect(visible.some(row => row.id === child.pageId)).toBe(true);
    const saved = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select().from(docState).where(and(eq(docState.knowledgeBaseId, fixture.alpha.id), eq(docState.pageId, moving.pageId))));
    expect(Buffer.from(saved[0]!.state)).toEqual(Buffer.from(encoded.state));
  } finally { encoded.ydoc.destroy(); }
});

test('transfer requires source full access, destination write access, same knowledge base and token write scope', async () => {
  const source = await fixture.tree({ defaultAccess: 'view' }), destination = await fixture.tree({ defaultAccess: 'edit' }), readOnly = await fixture.tree({ defaultAccess: 'view' }), foreign = await fixture.tree({ resource: 'beta' });
  await fixture.drain();
  const input = { ...source.root, targetTeamspaceId: destination.teamspace.id };
  await expect(reader().page.transfer.mutate(input)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => replaceAuthorizedPageAcl(db, { ...source.root, grants: [{ principal: principal('user', fixture.reader.identity.userId), level: 'full' }] }));
  await fixture.drain();
  await expect(reader().page.transfer.mutate({ ...input, targetTeamspaceId: readOnly.teamspace.id })).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  await expect(owner().page.transfer.mutate({ ...input, targetTeamspaceId: foreign.teamspace.id })).rejects.toBeDefined();
  const authorization = await fixture.createToken(fixture.owner, ['read']);
  await expect(fixture.apiClient({ authorization }).page.transfer.mutate(input)).rejects.toMatchObject({ data: { code: 'FORBIDDEN' } });
  const [record] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ folder: page.teamspaceId }).from(page).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, source.root.pageId))));
  expect(record?.folder).toBe(source.teamspace.id);
});

test('a queued transfer rechecks an expired session under the knowledge-base lock', async () => {
  const source = await fixture.tree(), destination = await fixture.tree(); await fixture.drain();
  const saved = await fixture.admin.query('SELECT expires_at FROM auth.session WHERE id=$1', [fixture.owner.identity.sessionId]);
  const connection = await fixture.admin.connect(); let response: Promise<unknown> | undefined;
  try {
    await connection.query('BEGIN'); await connection.query('SELECT id FROM resources.knowledge_base WHERE id=$1 FOR UPDATE', [fixture.alpha.id]);
    response = owner().page.transfer.mutate({ ...source.root, targetTeamspaceId: destination.teamspace.id });
    response.catch(() => {});
    await fixture.waitForKnowledgeBaseLock(connection);
    await connection.query("UPDATE auth.session SET expires_at=clock_timestamp()-interval '1 minute' WHERE id=$1", [fixture.owner.identity.sessionId]);
    await connection.query('COMMIT');
    await expect(response).rejects.toBeDefined();
    const [record] = await withKnowledgeBase(fixture.pool, fixture.alpha.id, db => db.select({ folder: page.teamspaceId }).from(page).where(and(eq(page.knowledgeBaseId, fixture.alpha.id), eq(page.id, source.root.pageId))));
    expect(record?.folder).toBe(source.teamspace.id);
  } finally { await connection.query('ROLLBACK'); if (response) await response.catch(() => {}); connection.release(); await fixture.admin.query('UPDATE auth.session SET expires_at=$1 WHERE id=$2', [saved.rows[0].expires_at, fixture.owner.identity.sessionId]); }
});

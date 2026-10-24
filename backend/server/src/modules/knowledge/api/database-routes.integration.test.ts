import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { principal } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { replaceAuthorizedPageAcl } from '../permissions/mutations';
import { createPermissionsFixture } from '../permissions/permissions-test-fixture';
import type { PermissionsFixture } from '../permissions/permissions-test-fixture';

describe('database routes', () => {
  let fixture: PermissionsFixture;
  beforeAll(async () => { fixture = await createPermissionsFixture(); });
  afterAll(async () => { await fixture.close(); });

  test('creates a database page, reads columns and rows, and edits a row through authorized routes', async () => {
    const { pages, teamspace } = await fixture.tree({ defaultAccess: 'edit', parents: [null] });
    await withKnowledgeBase(fixture.pool, fixture.alpha.id, (db) => replaceAuthorizedPageAcl(db, {
      knowledgeBaseId: fixture.alpha.id, pageId: pages[0]!.pageId,
      grants: [{ principal: principal('user', fixture.owner.identity.userId), level: 'full' }],
    }));
    await fixture.drain();
    const knowledgeBaseId = fixture.alpha.id;
    const client = fixture.apiClient({ cookie: fixture.owner.cookie, origin: fixture.server.webOrigin });
    expect(await client.page.access.query({ knowledgeBaseId, pageId: pages[0]!.pageId, action: 'edit' })).toMatchObject({ authorized: true });
    const databaseId = randomUUID();
    const columns = [{ id: 'status', name: '状态', type: 'select' as const, options: [{ id: 'todo', label: '待办', color: 'gray' }] }];
    expect(await client.database.create.mutate({
      id: databaseId, knowledgeBaseId, teamspaceId: teamspace.id, parentId: pages[0]!.pageId,
      title: '项目库', icon: null, cover: null, inheritsPermissions: true, afterPageId: null, columns,
    })).toEqual({ knowledgeBaseId, pageId: databaseId, columns });
    expect(await client.database.getColumns.query({ knowledgeBaseId, pageId: databaseId })).toEqual({ knowledgeBaseId, pageId: databaseId, columns });
    const rowId = randomUUID();
    await client.database.createRow.mutate({
      id: rowId, knowledgeBaseId, databaseId, title: '第一项', icon: null, cover: null,
      inheritsPermissions: true, afterPageId: null, properties: { status: 'todo' },
    });
    const rows = await client.database.listRows.query({ knowledgeBaseId, databaseId, filters: [], sort: [], limit: 20 });
    expect(rows.rows).toEqual([{ pageId: rowId, title: '第一项', properties: { status: 'todo' } }]);
    expect(rows.nextCursor).toBeNull();
    expect(await client.database.updateRowProperties.mutate({ knowledgeBaseId, pageId: rowId, properties: { status: null }, operationId: randomUUID() }))
      .toEqual({ knowledgeBaseId, pageId: rowId, properties: { status: null } });
  });
});

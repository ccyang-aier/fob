import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { OutboxEvent, PagePlacement, PageScope, Principal, PropertyDefinition } from '@fob/shared/knowledge/contracts';
import { knowledgeBase, resourceSchema, member, page, teamspace } from '../../../platform/database/resources/schema';
import { authUser } from '../../../platform/database/identity/schema';
import { createResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import type { ResourceTestDatabase } from '../../../platform/database/resources/resource-test-database';
import { recycleAuthorizedPage } from '../pages/tree';
import { authorizePageAccess, expandRequestPrincipals } from '../permissions/authorization';
import { replaceAuthorizedPageAcl, setAuthorizedPageInheritance } from '../permissions/mutations';
import { rebuildPermissionSubtree } from '../permissions/rebuild';
import { initializeKnowledgeJobs } from '../workers/initialize';
import { FobDatabaseError } from './errors';
import type { DatabaseErrorCode } from './errors';
import { createAuthorizedDatabase, createAuthorizedRow, listDatabaseRows, updateAuthorizedDatabaseColumns, updateAuthorizedRowProperties } from './service';

const canonical = /^[0-9a-z]{6}(?:[0-9a-z]*[1-9a-z])?$/;
const label = (pageId: string) => pageId.replaceAll('-', '_');
type AclEvent = Extract<OutboxEvent, { topic: 'acl.changed' }>;
type Grant = { principal: Principal; level: 'view' | 'edit' | 'full' };

let database: ResourceTestDatabase;
let concurrent: Pool;
const alpha = { knowledgeBaseId: randomUUID(), owner: randomUUID(), editor: randomUUID(), viewer: randomUUID(), main: randomUUID() };
const beta = { knowledgeBaseId: randomUUID(), owner: randomUUID(), teamspace: randomUUID() };

async function rejects(operation: () => Promise<unknown>, code: DatabaseErrorCode) {
  let failure: unknown;
  try {
    await operation();
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(FobDatabaseError);
  expect((failure as FobDatabaseError).code).toBe(code);
}

async function rows<T extends Record<string, unknown>>(query: string, values: unknown[] = []): Promise<T[]> {
  return (await database.admin.query(query, values)).rows as T[];
}

async function rebuild(scope: PageScope) {
  const result = await rows<{ payload: AclEvent }>(
    "SELECT payload FROM resources.outbox WHERE knowledge_base_id=$1 AND topic='acl.changed' AND payload->>'rootPageId'=$2 ORDER BY (payload->>'revision')::bigint DESC LIMIT 1",
    [scope.knowledgeBaseId, scope.pageId],
  );
  if (!result[0]) throw new Error('Expected an acl.changed event');
  await withKnowledgeBase(database.pool, scope.knowledgeBaseId, (db) => rebuildPermissionSubtree(db, result[0]!.payload));
}

const resource = <T>(operation: (db: ResourceTransaction) => Promise<T>, pool?: Pool) =>
  withKnowledgeBase(pool ?? database.pool, alpha.knowledgeBaseId, operation);

const knowledgeBasePrincipal = () => `knowledgeBase:${alpha.knowledgeBaseId}` as Principal;

async function storedRow(scope: PageScope) {
  const [row] = await rows<{ kind: string; parent_id: string | null; database_id: string | null; path: string; position: string; properties: Record<string, unknown> }>(
    'SELECT kind, parent_id::text AS parent_id, database_id::text AS database_id, path::text AS path, position, properties FROM resources.page WHERE knowledge_base_id=$1 AND id=$2',
    [scope.knowledgeBaseId, scope.pageId],
  );
  return row!;
}

function createDatabase(seed: { id?: string; columns?: PropertyDefinition[]; title?: string; resource?: 'alpha' | 'beta' } = {}) {
  const foreign = seed.resource === 'beta';
  const scope = foreign ? beta : alpha;
  return withKnowledgeBase(database.pool, scope.knowledgeBaseId, (db) => createAuthorizedDatabase(db, {
    id: seed.id ?? randomUUID(),
    knowledgeBaseId: scope.knowledgeBaseId,
    teamspaceId: foreign ? beta.teamspace : alpha.main,
    parentId: null,
    title: seed.title ?? '数据库',
    columns: seed.columns ?? [],
  }, scope.owner));
}

function createRow(seed: { id?: string; databaseId: string; properties?: Record<string, unknown>; title?: string; resource?: 'alpha' | 'beta'; pool?: Pool }): Promise<PagePlacement> {
  const foreign = seed.resource === 'beta';
  const scope = foreign ? beta : alpha;
  return withKnowledgeBase(seed.pool ?? database.pool, scope.knowledgeBaseId, (db) => createAuthorizedRow(db, {
    id: seed.id ?? randomUUID(),
    knowledgeBaseId: scope.knowledgeBaseId,
    title: seed.title ?? '行',
    databaseId: seed.databaseId,
    properties: seed.properties ?? {},
    afterPageId: null,
  }, scope.owner));
}

function listRows(seed: { databaseId: string; viewer: Principal[]; filters?: unknown[]; sort?: { propertyId: string; direction: 'asc' | 'desc' }[]; cursor?: string; limit?: number; resource?: 'alpha' | 'beta' }) {
  const foreign = seed.resource === 'beta';
  const scope = foreign ? beta : alpha;
  return withKnowledgeBase(database.pool, scope.knowledgeBaseId, (db) => listDatabaseRows(db, {
    knowledgeBaseId: scope.knowledgeBaseId,
    databaseId: seed.databaseId,
    viewer: seed.viewer,
    filters: seed.filters ?? [],
    sort: seed.sort ?? [],
    ...(seed.cursor === undefined ? {} : { cursor: seed.cursor }),
    limit: seed.limit ?? 50,
  }));
}

beforeAll(async () => {
  database = await createResourceTestDatabase();
  concurrent = new Pool({ ...database.pool.options, max: 4 });
  await initializeKnowledgeJobs(database.admin, database.pool);
  const client = await database.admin.connect();
  try {
    await client.query('BEGIN');
    const db = drizzle(client, { schema: resourceSchema });
    await db.insert(authUser).values([
      { id: alpha.owner, name: 'Alpha Owner', email: `${alpha.owner}@databases.test` },
      { id: alpha.editor, name: 'Alpha Editor', email: `${alpha.editor}@databases.test` },
      { id: alpha.viewer, name: 'Alpha Viewer', email: `${alpha.viewer}@databases.test` },
      { id: beta.owner, name: 'Beta Owner', email: `${beta.owner}@databases.test` },
    ]);
    await db.insert(knowledgeBase).values([
      { id: alpha.knowledgeBaseId, name: 'Databases Alpha' },
      { id: beta.knowledgeBaseId, name: 'Databases Beta' },
    ]);
    await db.insert(member).values([
      { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.owner, role: 'owner' },
      { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.editor, role: 'member' },
      { knowledgeBaseId: alpha.knowledgeBaseId, userId: alpha.viewer, role: 'member' },
      { knowledgeBaseId: beta.knowledgeBaseId, userId: beta.owner, role: 'owner' },
    ]);

    await db.insert(teamspace).values([
      { knowledgeBaseId: alpha.knowledgeBaseId, id: alpha.main, name: 'Main', defaultAccess: 'view' },
      { knowledgeBaseId: beta.knowledgeBaseId, id: beta.teamspace, name: 'Beta', defaultAccess: 'view' },
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}, 60_000);

afterAll(async () => {
  if (concurrent) await concurrent.end();
  if (database) await database.dispose();
}, 60_000);

describe('T02 databases and rows are pages', () => {
  test('creating a database stores a kind=database page plus its typed column schema', async () => {
    const id = randomUUID();
    const columns: PropertyDefinition[] = [{ id: 'name', name: '名称', type: 'text' }, { id: 'count', name: '数量', type: 'number' }];
    const created = await createDatabase({ id, columns, title: '项目库' });
    expect(created).toEqual({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: id, columns });
    const stored = await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: id });
    expect(stored.kind).toBe('database');
    expect(stored.parent_id).toBeNull();
    expect(stored.database_id).toBeNull();
    expect(stored.path).toBe(label(id));
    expect(stored.position).toMatch(canonical);
    const [definition] = await rows<{ properties: PropertyDefinition[] }>(
      'SELECT properties FROM resources.database_definition WHERE knowledge_base_id=$1 AND page_id=$2', [alpha.knowledgeBaseId, id]);
    expect(definition!.properties).toEqual(columns);
  });

  test('a row is a standalone page placed under its database with its own properties', async () => {
    const columns: PropertyDefinition[] = [{ id: 'topic', name: '主题', type: 'text' }, { id: 'count', name: '数量', type: 'number' }];
    const owner = await createDatabase({ columns });
    const rowId = randomUUID();
    const placed = await createRow({ id: rowId, databaseId: owner.pageId, properties: { topic: '第一条', count: 3 }, title: '第一条' });
    expect(placed.parentId).toBe(owner.pageId);
    expect(placed.path).toBe(`${label(owner.pageId)}.${label(rowId)}`);
    expect(placed.position).toMatch(canonical);
    const stored = await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: rowId });
    expect(stored).toMatchObject({ kind: 'row', parent_id: owner.pageId, database_id: owner.pageId, properties: { topic: '第一条', count: 3 } });
  });

  test('replaying ids is idempotent and keeps the stored definition', async () => {
    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    const rowId = randomUUID();
    const first = await createRow({ id: rowId, databaseId: owner.pageId, properties: { a: '初值' } });
    const replay = await createRow({ id: rowId, databaseId: owner.pageId, properties: { a: '重放' } });
    expect(replay).toEqual(first);
    const [count] = await rows<{ n: string }>('SELECT count(*)::text AS n FROM resources.page WHERE knowledge_base_id=$1 AND id=$2', [alpha.knowledgeBaseId, rowId]);
    expect(count!.n).toBe('1');

    const replayed = await createDatabase({ id: owner.pageId, columns: [{ id: 'b', name: 'B', type: 'number' }] });
    expect(replayed.columns).toEqual([{ id: 'a', name: 'A', type: 'text' }]);
  });

  test('ids colliding with other page kinds and missing or recycled databases are rejected', async () => {
    const docId = randomUUID();
    await resource((db) => db.insert(page).values({ knowledgeBaseId: alpha.knowledgeBaseId, id: docId, teamspaceId: alpha.main, parentId: null, position: 'a0', path: label(docId), createdBy: alpha.owner }));
    await rejects(() => createDatabase({ id: docId }), 'INVALID_DATABASE_INPUT');
    await rejects(() => createRow({ id: docId, databaseId: randomUUID() }), 'DATABASE_NOT_FOUND');

    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    await rejects(() => createRow({ id: docId, databaseId: owner.pageId }), 'INVALID_DATABASE_INPUT');
    const other = await createDatabase();
    await rejects(() => createRow({ id: docId, databaseId: other.pageId }), 'INVALID_DATABASE_INPUT');
    await rejects(() => createRow({ databaseId: randomUUID() }), 'DATABASE_NOT_FOUND');
    await rejects(() => createRow({ databaseId: docId }), 'DATABASE_NOT_FOUND');

    await resource((db) => recycleAuthorizedPage(db, { knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId }));
    await rejects(() => createRow({ databaseId: owner.pageId }), 'DATABASE_NOT_FOUND');
  });
});

describe('T02 per-row permissions and visibility', () => {
  test('rows carry differentiated view/edit grants enforced by P03 materialization', async () => {
    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    const inherited = (await createRow({ databaseId: owner.pageId, properties: { a: '继承' } })).pageId;
    const editorOnlyViews = (await createRow({ databaseId: owner.pageId, properties: { a: '编辑可见' } })).pageId;
    const editorEdits = (await createRow({ databaseId: owner.pageId, properties: { a: '编辑可写' } })).pageId;
    const sealed = (await createRow({ databaseId: owner.pageId, properties: { a: '无人可见' } })).pageId;
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });

    const changes: [string, Grant[]][] = [
      [editorOnlyViews, [{ principal: `user:${alpha.editor}` as Principal, level: 'view' }]],
      [editorEdits, [{ principal: `user:${alpha.editor}` as Principal, level: 'edit' }, { principal: `user:${alpha.viewer}` as Principal, level: 'view' }]],
      [sealed, []],
    ];
    for (const [pageId, grants] of changes) {
      await resource((db) => setAuthorizedPageInheritance(db, { knowledgeBaseId: alpha.knowledgeBaseId, pageId, inheritsPermissions: false }));
      await resource((db) => replaceAuthorizedPageAcl(db, { knowledgeBaseId: alpha.knowledgeBaseId, pageId, grants }));
    }
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });

    const decide = (userId: string, pageId: string, required: 'view' | 'edit') =>
      resource((db) => authorizePageAccess(db, { userId, scope: { knowledgeBaseId: alpha.knowledgeBaseId, pageId }, required }));
    expect(await decide(alpha.viewer, editorEdits, 'view')).toMatchObject({ decision: 'allow', level: 'view' });
    expect(await decide(alpha.viewer, editorEdits, 'edit')).toMatchObject({ decision: 'deny' });
    expect(await decide(alpha.editor, editorEdits, 'edit')).toMatchObject({ decision: 'allow', level: 'edit' });
    expect(await decide(alpha.viewer, editorOnlyViews, 'view')).toMatchObject({ decision: 'deny' });
    expect(await decide(alpha.editor, editorOnlyViews, 'view')).toMatchObject({ decision: 'allow', level: 'view' });
    expect(await decide(alpha.owner, editorOnlyViews, 'view')).toMatchObject({ decision: 'deny' });
    expect(await decide(alpha.owner, sealed, 'view')).toMatchObject({ decision: 'deny' });
    expect(await decide(beta.owner, inherited, 'view')).toMatchObject({ decision: 'deny' });

    const editorPrincipals = await resource((db) => expandRequestPrincipals(db, alpha.knowledgeBaseId, alpha.editor));
    const viewerPrincipals = await resource((db) => expandRequestPrincipals(db, alpha.knowledgeBaseId, alpha.viewer));
    const ownerPrincipals = await resource((db) => expandRequestPrincipals(db, alpha.knowledgeBaseId, alpha.owner));
    // 无排序参数时列表按 position/id 返回;可见性断言比较集合,故对结果排序。
    const ids = (result: { rows: { pageId: string }[] }) => result.rows.map((row) => row.pageId).sort();
    // 打断继承的行仅剩显式 ACL:knowledgeBase 主体只携带 teamspace 默认访问,故只见继承行。
    expect(ids(await listRows({ databaseId: owner.pageId, viewer: [knowledgeBasePrincipal()] }))).toEqual([inherited]);
    expect(ids(await listRows({ databaseId: owner.pageId, viewer: viewerPrincipals }))).toEqual([inherited, editorEdits].sort());
    expect(ids(await listRows({ databaseId: owner.pageId, viewer: editorPrincipals }))).toEqual([inherited, editorOnlyViews, editorEdits].sort());
    expect(ids(await listRows({ databaseId: owner.pageId, viewer: ownerPrincipals }))).toEqual([inherited].sort());
    expect(await listRows({ databaseId: owner.pageId, viewer: [`user:${beta.owner}`, `knowledgeBase:${beta.knowledgeBaseId}`] })).toEqual({ rows: [], nextCursor: null });

    await resource((db) => recycleAuthorizedPage(db, { knowledgeBaseId: alpha.knowledgeBaseId, pageId: editorEdits }));
    expect(ids(await listRows({ databaseId: owner.pageId, viewer: viewerPrincipals }))).toEqual([inherited].sort());
  });

  test('an empty database lists no rows', async () => {
    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });
    expect(await listRows({ databaseId: owner.pageId, viewer: [knowledgeBasePrincipal()] })).toEqual({ rows: [], nextCursor: null });
  });
});

describe('T02 typed row property validation', () => {
  const target = { databaseId: '', rowId: '' };

  beforeAll(async () => {
    const relationTarget = await createDatabase({ columns: [{ id: 'n', name: 'N', type: 'text' }] });
    target.databaseId = relationTarget.pageId;
    target.rowId = (await createRow({ databaseId: relationTarget.pageId })).pageId;
  });

  const columns = (): PropertyDefinition[] => [
    { id: 'name', name: '名称', type: 'text' },
    { id: 'count', name: '数量', type: 'number' },
    { id: 'done', name: '完成', type: 'checkbox' },
    { id: 'due', name: '截止', type: 'date' },
    { id: 'status', name: '状态', type: 'select', options: [{ id: 'todo', label: '待办', color: 'blue' }, { id: 'done', label: '完成', color: 'green' }] },
    { id: 'tags', name: '标签', type: 'multiSelect', options: [{ id: 'a', label: 'A', color: 'red' }, { id: 'b', label: 'B', color: 'gray' }] },
    { id: 'site', name: '链接', type: 'url' },
    { id: 'assignee', name: '负责人', type: 'person' },
    { id: 'link', name: '关联', type: 'relation', relationDatabaseId: target.databaseId },
  ];

  test('accepts every declared column type including ISO datetime dates', async () => {
    const owner = await createDatabase({ columns: columns() });
    const valid = {
      name: '一条记录', count: 3.5, done: false, due: '2026-09-26T10:00:00Z', status: 'todo',
      tags: ['a', 'b'], site: 'https://example.com/x', assignee: [alpha.editor], link: [target.rowId],
    };
    const placed = await createRow({ databaseId: owner.pageId, properties: valid });
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: placed.pageId })).properties).toEqual(valid);
  });

  test('rejects unknown properties and every kind of type mismatch', async () => {
    const owner = await createDatabase({ columns: columns() });
    const good = { name: 'x', count: 1 };
    const row = await createRow({ databaseId: owner.pageId, properties: good });
    for (const properties of [
      { unknown: 'x' },
      { name: 5 },
      { count: '3' },
      { done: 'yes' },
      { due: '2026-13-99' },
      { due: 'yesterday' },
      { status: 'unknown' },
      { status: ['todo'] },
      { tags: 'a' },
      { tags: ['a', 'a'] },
      { tags: ['a', 'x'] },
      { site: 'not-a-url' },
      { site: 42 },
      { assignee: ['not-a-uuid'] },
      { assignee: [alpha.editor, alpha.editor] },
      { link: [randomUUID()] },
      { link: [row.pageId] },
    ]) {
      await rejects(() => createRow({ databaseId: owner.pageId, properties }), 'INVALID_ROW_PROPERTIES');
    }
    // 数字数组不是可表示的属性值形态,在契约层即被拒绝。
    await rejects(() => createRow({ databaseId: owner.pageId, properties: { count: [1] } }), 'INVALID_DATABASE_INPUT');
    await createRow({ databaseId: owner.pageId, properties: { ...good, count: null, due: null, tags: null } });
  });

  test('relation columns must reference an existing database and resolvable rows', async () => {
    await rejects(() => createDatabase({ columns: [{ id: 'link', name: '关联', type: 'relation', relationDatabaseId: randomUUID() }] }), 'INVALID_DATABASE_COLUMNS');
    const owner = await createDatabase({ columns: [{ id: 'n', name: 'N', type: 'text' }] });
    await rejects(() => resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId,
      columns: [{ id: 'link', name: '关联', type: 'relation', relationDatabaseId: randomUUID() }],
    })), 'INVALID_DATABASE_COLUMNS');
  });

  test('property updates replace the stored object after validation and leave it intact on rejection', async () => {
    const owner = await createDatabase({ columns: columns() });
    const row = await createRow({ databaseId: owner.pageId, properties: { name: '旧值', count: 1 } });
    const updated = await resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId, properties: { name: '新值', count: 2, status: 'done' }, operationId: randomUUID(),
    }));
    expect(updated).toEqual({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId, properties: { name: '新值', count: 2, status: 'done' } });
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId })).properties).toEqual({ name: '新值', count: 2, status: 'done' });

    await rejects(() => resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId, properties: { name: '坏值', ghost: 1 }, operationId: randomUUID(),
    })), 'INVALID_ROW_PROPERTIES');
    await rejects(() => resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId, properties: { name: '坏值', count: '2' }, operationId: randomUUID(),
    })), 'INVALID_ROW_PROPERTIES');
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: row.pageId })).properties).toEqual({ name: '新值', count: 2, status: 'done' });

    await rejects(() => resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: randomUUID(), properties: {}, operationId: randomUUID(),
    })), 'ROW_NOT_FOUND');
    const docId = randomUUID();
    await resource((db) => db.insert(page).values({ knowledgeBaseId: alpha.knowledgeBaseId, id: docId, teamspaceId: alpha.main, parentId: null, position: 'a0', path: label(docId), createdBy: alpha.owner }));
    await rejects(() => resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: docId, properties: {}, operationId: randomUUID(),
    })), 'INVALID_DATABASE_INPUT');
  });
});

describe('T02 filtering, sorting and cursor pagination', () => {
  const seeded = { databaseId: '', byName: {} as Record<string, string> };

  beforeAll(async () => {
    const columns: PropertyDefinition[] = [
      { id: 'name', name: '名称', type: 'text' },
      { id: 'count', name: '数量', type: 'number' },
      { id: 'status', name: '状态', type: 'select', options: [{ id: 'todo', label: '待办', color: 'blue' }, { id: 'doing', label: '进行', color: 'yellow' }, { id: 'done', label: '完成', color: 'green' }] },
      { id: 'tags', name: '标签', type: 'multiSelect', options: [{ id: 'a', label: 'A', color: 'red' }, { id: 'b', label: 'B', color: 'gray' }] },
      { id: 'due', name: '截止', type: 'date' },
    ];
    const owner = await createDatabase({ columns });
    seeded.databaseId = owner.pageId;
    const dataset: [string, Record<string, unknown>][] = [
      ['alpha task', { count: 5, status: 'todo', tags: ['a'], due: '2026-01-10' }],
      ['Beta task', { count: 2, status: 'doing', tags: ['a', 'b'], due: '2026-02-20' }],
      ['gamma note', { count: 10, status: 'done', tags: [], due: null }],
      ['delta', { tags: ['b'] }],
      ['task epsilon', { count: 7, status: 'todo', due: '2026-03-30' }],
      ['50%_x', { count: 1 }],
      ['task x', { count: 0 }],
    ];
    for (const [name, properties] of dataset) {
      seeded.byName[name] = (await createRow({ databaseId: owner.pageId, properties: { name, ...properties }, title: name })).pageId;
    }
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });
  });

  const viewer = [knowledgeBasePrincipal()];
  const ids = async (seed: Parameters<typeof listRows>[0]) => (await listRows(seed)).rows.map((row) => row.pageId);
  const byName = (...wanted: string[]) => wanted.map((name) => seeded.byName[name]!);

  test('filters cover equality, negation, ranges, membership, substring and emptiness', async () => {
    const id = seeded.databaseId;
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'count', operator: 'gte', value: 2 }, { propertyId: 'count', operator: 'lte', value: 7 }] }))
      .toEqual(byName('alpha task', 'Beta task', 'task epsilon'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'count', operator: 'gt', value: 7 }] })).toEqual(byName('gamma note'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'status', operator: 'eq', value: 'todo' }] })).toEqual(byName('alpha task', 'task epsilon'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'status', operator: 'neq', value: 'todo' }] })).toEqual(byName('Beta task', 'gamma note'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'tags', operator: 'contains', value: 'b' }] })).toEqual(byName('Beta task', 'delta'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'tags', operator: 'eq', value: 'a' }] })).toEqual(byName('alpha task', 'Beta task'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'name', operator: 'contains', value: 'task' }] })).toEqual(byName('alpha task', 'Beta task', 'task epsilon', 'task x'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'name', operator: 'contains', value: '%_x' }] })).toEqual(byName('50%_x'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'due', operator: 'isEmpty' }] })).toEqual(byName('gamma note', 'delta', '50%_x', 'task x'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'due', operator: 'isNotEmpty' }] })).toEqual(byName('alpha task', 'Beta task', 'task epsilon'));
    expect(await ids({ databaseId: id, viewer, filters: [{ propertyId: 'due', operator: 'gte', value: '2026-02-01' }, { propertyId: 'status', operator: 'neq', value: 'done' }] })).toEqual(byName('Beta task', 'task epsilon'));
  });

  test('invalid filters, sorts and cursors are rejected before any query runs', async () => {
    const id = seeded.databaseId;
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'ghost', operator: 'eq', value: 1 }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'count', operator: 'eq', value: 'x' }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'status', operator: 'gt', value: 'todo' }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'count', operator: 'contains', value: 5 }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'status', operator: 'contains', value: 'to' }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'tags', operator: 'contains', value: 'x' }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, filters: [{ propertyId: 'name', operator: 'contains', value: 5 }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, sort: [{ propertyId: 'ghost', direction: 'asc' }] }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: id, viewer, cursor: randomUUID() }), 'INVALID_DATABASE_QUERY');
    await rejects(() => listRows({ databaseId: randomUUID(), viewer }), 'DATABASE_NOT_FOUND');
  });

  test('sorting supports multiple columns; empty values sort first ascending and last descending', async () => {
    const id = seeded.databaseId;
    expect(await ids({ databaseId: id, viewer, sort: [{ propertyId: 'count', direction: 'asc' }] }))
      .toEqual(byName('delta', 'task x', '50%_x', 'Beta task', 'alpha task', 'task epsilon', 'gamma note'));
    expect(await ids({ databaseId: id, viewer, sort: [{ propertyId: 'count', direction: 'desc' }] }))
      .toEqual(byName('gamma note', 'task epsilon', 'alpha task', 'Beta task', '50%_x', 'task x', 'delta'));
    // jsonb 字符串序遵循数据库 collation:'doing' < 'done'(i < n)。
    expect(await ids({ databaseId: id, viewer, sort: [{ propertyId: 'status', direction: 'asc' }, { propertyId: 'count', direction: 'desc' }] }))
      .toEqual(byName('50%_x', 'task x', 'delta', 'Beta task', 'gamma note', 'task epsilon', 'alpha task'));
  });

  test('cursor pagination walks the full ordered set without duplicates or gaps', async () => {
    const id = seeded.databaseId;
    const collected: string[] = [];
    let cursor: string | undefined;
    for (let step = 0; step < 10; step++) {
      const result = await listRows({ databaseId: id, viewer, sort: [{ propertyId: 'count', direction: 'asc' }], limit: 3, ...(cursor === undefined ? {} : { cursor }) });
      collected.push(...result.rows.map((row) => row.pageId));
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    expect(collected).toEqual(byName('delta', 'task x', '50%_x', 'Beta task', 'alpha task', 'task epsilon', 'gamma note'));

    const filtered: string[] = [];
    let filteredCursor: string | undefined;
    for (let step = 0; step < 10; step++) {
      const result = await listRows({ databaseId: id, viewer, filters: [{ propertyId: 'status', operator: 'eq', value: 'todo' }], limit: 1, ...(filteredCursor === undefined ? {} : { cursor: filteredCursor }) });
      filtered.push(...result.rows.map((row) => row.pageId));
      if (result.nextCursor === null) break;
      filteredCursor = result.nextCursor;
    }
    expect(filtered).toEqual(byName('alpha task', 'task epsilon'));

    const whole = await listRows({ databaseId: id, viewer, limit: 100 });
    expect(whole.nextCursor).toBeNull();
    expect(whole.rows).toHaveLength(7);
  });
});

describe('T02 column lifecycle', () => {
  test('adding a column serves existing rows as empty, removal drops stored data, retyping is refused', async () => {
    const owner = await createDatabase({ columns: [{ id: 'name', name: '名称', type: 'text' }, { id: 'count', name: '数量', type: 'number' }] });
    const first = await createRow({ databaseId: owner.pageId, properties: { name: '一', count: 1 } });
    const second = await createRow({ databaseId: owner.pageId, properties: { name: '二', count: 2 } });
    const nameColumn = { id: 'name', name: '标题', type: 'text' } as const;
    const prioColumn = { id: 'prio', name: '优先级', type: 'select', options: [{ id: 'high', label: '高', color: 'red' }] } as const;
    const countColumn = { id: 'count', name: '数量', type: 'number' } as const;

    const added = await resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId, columns: [nameColumn, countColumn, prioColumn],
    }));
    expect(added.columns.map((entry) => entry.id)).toEqual(['name', 'count', 'prio']);
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: first.pageId })).properties).toEqual({ name: '一', count: 1 });
    const third = await createRow({ databaseId: owner.pageId, properties: { name: '三', prio: 'high' } });
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });
    const withPrio = await listRows({ databaseId: owner.pageId, viewer: [knowledgeBasePrincipal()], filters: [{ propertyId: 'prio', operator: 'isNotEmpty' }] });
    expect(withPrio.rows.map((row) => row.pageId)).toEqual([third.pageId]);

    await rejects(() => resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId,
      columns: [{ id: 'name', name: '名称', type: 'number' }, countColumn, prioColumn],
    })), 'INVALID_DATABASE_COLUMNS');
    const [afterReject] = await rows<{ properties: PropertyDefinition[] }>(
      'SELECT properties FROM resources.database_definition WHERE knowledge_base_id=$1 AND page_id=$2', [alpha.knowledgeBaseId, owner.pageId]);
    expect(afterReject!.properties.find((entry) => entry.id === 'name')).toMatchObject({ type: 'text', name: '标题' });
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: first.pageId })).properties).toEqual({ name: '一', count: 1 });

    const removed = await resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId, columns: [nameColumn, prioColumn],
    }));
    expect(removed.columns.map((entry) => entry.id)).toEqual(['name', 'prio']);
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: first.pageId })).properties).toEqual({ name: '一' });
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: second.pageId })).properties).toEqual({ name: '二' });
    await rejects(() => resource((db) => updateAuthorizedRowProperties(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: first.pageId, properties: { name: '一', count: 9 }, operationId: randomUUID(),
    })), 'INVALID_ROW_PROPERTIES');
    await rejects(() => listRows({ databaseId: owner.pageId, viewer: [knowledgeBasePrincipal()], filters: [{ propertyId: 'count', operator: 'gt', value: 0 }] }), 'INVALID_DATABASE_QUERY');

    const unchanged = await resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId, columns: [nameColumn, prioColumn],
    }));
    expect(unchanged.columns).toEqual(removed.columns);
    await rejects(() => resource((db) => updateAuthorizedDatabaseColumns(db, {
      knowledgeBaseId: alpha.knowledgeBaseId, pageId: randomUUID(), columns: [],
    })), 'DATABASE_NOT_FOUND');
  });
});

describe('T02 resource isolation and concurrent row creation', () => {
  test('a foreign resource cannot see or feed another knowledgeBase database', async () => {
    const foreign = await createDatabase({ resource: 'beta', columns: [{ id: 'n', name: 'N', type: 'text' }] });
    await createRow({ resource: 'beta', databaseId: foreign.pageId, properties: { n: 'beta row' } });
    await rejects(() => createRow({ databaseId: foreign.pageId }), 'DATABASE_NOT_FOUND');
    await rejects(() => listRows({ databaseId: foreign.pageId, viewer: [knowledgeBasePrincipal()] }), 'DATABASE_NOT_FOUND');
    await rebuild({ knowledgeBaseId: beta.knowledgeBaseId, pageId: foreign.pageId });
    const seen = await listRows({ resource: 'beta', databaseId: foreign.pageId, viewer: [`knowledgeBase:${beta.knowledgeBaseId}`] });
    expect(seen.rows.map((row) => row.properties.n)).toEqual(['beta row']);
    expect((await withKnowledgeBase(database.pool, beta.knowledgeBaseId, (db) => db.select({ id: page.id }).from(page).where(eq(page.knowledgeBaseId, alpha.knowledgeBaseId)))).length).toBe(0);
  });

  test('concurrent creations of the same row id converge on one stored page', async () => {
    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    const id = randomUUID();
    const [one, two] = await Promise.all([
      createRow({ id, databaseId: owner.pageId, properties: { a: '并发' }, title: '第一次', pool: concurrent }),
      createRow({ id, databaseId: owner.pageId, properties: { a: '并发' }, title: '第二次', pool: concurrent }),
    ]);
    expect(one).toEqual(two);
    const [count] = await rows<{ n: string }>('SELECT count(*)::text AS n FROM resources.page WHERE knowledge_base_id=$1 AND id=$2', [alpha.knowledgeBaseId, id]);
    expect(count!.n).toBe('1');
    expect((await storedRow({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: id })).properties).toEqual({ a: '并发' });
  });

  test('concurrent distinct rows under one database get distinct placements', async () => {
    const owner = await createDatabase({ columns: [{ id: 'a', name: 'A', type: 'text' }] });
    const [one, two] = await Promise.all([
      createRow({ databaseId: owner.pageId, properties: { a: '左' }, pool: concurrent }),
      createRow({ databaseId: owner.pageId, properties: { a: '右' }, pool: concurrent }),
    ]);
    expect(one.position).not.toBe(two.position);
    await rebuild({ knowledgeBaseId: alpha.knowledgeBaseId, pageId: owner.pageId });
    const seen = await listRows({ databaseId: owner.pageId, viewer: [knowledgeBasePrincipal()] });
    expect(seen.rows.map((row) => row.pageId).sort()).toEqual([one.pageId, two.pageId].sort());
  });
});

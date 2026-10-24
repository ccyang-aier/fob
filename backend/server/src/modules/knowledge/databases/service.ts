import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  createDatabaseInputSchema,
  createRowInputSchema,
  databaseRowsPageSchema,
  entityIdSchema,
  listDatabaseRowsInputSchema,
  pagePlacementSchema,
  updateDatabaseColumnsInputSchema,
  updatePropertiesInputSchema,
} from '@fob/shared/knowledge/contracts';
import type {
  DatabaseColumnsState,
  DatabaseRowsPage,
  OutboxEvent,
  PagePlacement,
  PageScope,
  Properties,
  PropertyDefinition,
  RowPropertiesState,
} from '@fob/shared/knowledge/contracts';
import { z } from 'zod';
import { databaseDefinition, page } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { createAuthorizedPage } from '../pages/tree';
import { lockPermissionPage } from '../permissions/locking';
import { effectivePageAccessCondition } from '../permissions/queries';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { FobDatabaseError } from './errors';
import { compileRowFilters, compileRowOrder, compileRowSeek, relationReferences, validateRowProperties } from './properties';

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new FobDatabaseError('INVALID_DATABASE_INPUT');
  return parsed.data;
}

const placement = (row: { id: string; parentId: string | null; teamspaceId: string; position: string; path: string }): PagePlacement =>
  pagePlacementSchema.parse({ pageId: row.id, parentId: row.parentId, teamspaceId: row.teamspaceId, position: row.position, path: row.path });

/** 租户内可见(未回收)的数据库定义;跨租户/不存在/已回收统一为 DATABASE_NOT_FOUND。 */
async function loadDatabase(db: ResourceTransaction, scope: { knowledgeBaseId: string; pageId: string }) {
  const [record] = await db.select({ teamspaceId: page.teamspaceId, columns: databaseDefinition.properties })
    .from(databaseDefinition)
    .innerJoin(page, and(eq(page.knowledgeBaseId, databaseDefinition.knowledgeBaseId), eq(page.id, databaseDefinition.pageId)))
    .where(and(eq(databaseDefinition.knowledgeBaseId, scope.knowledgeBaseId), eq(databaseDefinition.pageId, scope.pageId), isNull(page.deletedAt)));
  if (!record) throw new FobDatabaseError('DATABASE_NOT_FOUND');
  return record;
}

/** relation 列的目标必须是本租户内未回收的数据库页面。 */
async function assertRelationTargets(db: ResourceTransaction, knowledgeBaseId: string, columns: PropertyDefinition[]): Promise<void> {
  const targets = [...new Set(columns.filter((column) => column.type === 'relation').map((column) => column.relationDatabaseId!))];
  if (!targets.length) return;
  const found = await db.select({ id: page.id }).from(page)
    .where(and(eq(page.knowledgeBaseId, knowledgeBaseId), inArray(page.id, targets), eq(page.kind, 'database'), isNull(page.deletedAt)));
  if (found.length !== targets.length) throw new FobDatabaseError('INVALID_DATABASE_COLUMNS');
}

/** relation 属性值引用的每个页面都必须是目标数据库下未回收的行页面。 */
async function assertRelationValues(db: ResourceTransaction, knowledgeBaseId: string, columns: PropertyDefinition[], properties: Properties): Promise<void> {
  for (const [target, ids] of relationReferences(columns, properties)) {
    const unique = [...new Set(ids)];
    const found = await db.select({ id: page.id }).from(page)
      .where(and(eq(page.knowledgeBaseId, knowledgeBaseId), eq(page.databaseId, target), eq(page.kind, 'row'), isNull(page.deletedAt), inArray(page.id, unique)));
    if (found.length !== unique.length) throw new FobDatabaseError('INVALID_ROW_PROPERTIES');
  }
}

/** §5.3 知识库频道事件与业务写入同事务落 outbox,由既有 dispatch 管道消费。 */
async function emitRowsChanged(db: ResourceTransaction, input: { knowledgeBaseId: string; databaseId: string; ids: string[] }): Promise<void> {
  const event: Extract<OutboxEvent, { topic: 'knowledgeBase.event' }> = {
    knowledgeBaseId: input.knowledgeBaseId,
    topic: 'knowledgeBase.event',
    event: { knowledgeBaseId: input.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'database.rows.changed', databaseId: input.databaseId, ids: input.ids },
  };
  await appendKnowledgeOutbox(db, event);
}

async function emitColumnsChanged(db: ResourceTransaction, scope: PageScope): Promise<void> {
  const event: Extract<OutboxEvent, { topic: 'knowledgeBase.event' }> = {
    knowledgeBaseId: scope.knowledgeBaseId,
    topic: 'knowledgeBase.event',
    event: { knowledgeBaseId: scope.knowledgeBaseId, id: randomUUID(), occurredAt: new Date().toISOString(), type: 'page.updated', ids: [scope.pageId] },
  };
  await appendKnowledgeOutbox(db, event);
}

/**
 * P03 必须先在目标父页面(移至根级时为 teamspace 根域)上以 authorizePageAccess
 * 校验至少 edit 后才能调用本函数。数据库即页面:kind=database 的页面与列 schema
 * 定义同事务创建;显式 id 由客户端生成,重复提交同一 id 返回现有数据库与已存储
 * 的列定义。列 schema 中 relation 列的目标数据库必须已存在。
 */
export async function createAuthorizedDatabase(db: ResourceTransaction, input: unknown, createdBy: string): Promise<DatabaseColumnsState> {
  const parsed = parse(createDatabaseInputSchema, input);
  if (!entityIdSchema.safeParse(createdBy).success) throw new FobDatabaseError('INVALID_DATABASE_INPUT');
  await assertRelationTargets(db, parsed.knowledgeBaseId, parsed.columns);
  const [existing] = await db.select({ kind: page.kind }).from(page).where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.id)));
  if (existing && existing.kind !== 'database') throw new FobDatabaseError('INVALID_DATABASE_INPUT');
  const placed = await createAuthorizedPage(db, {
    id: parsed.id,
    knowledgeBaseId: parsed.knowledgeBaseId,
    teamspaceId: parsed.teamspaceId,
    parentId: parsed.parentId,
    kind: 'database',
    databaseId: null,
    properties: {},
    title: parsed.title,
    icon: parsed.icon,
    cover: parsed.cover,
    inheritsPermissions: parsed.inheritsPermissions,
    afterPageId: parsed.afterPageId,
  }, createdBy);
  await db.insert(databaseDefinition).values({ knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.id, teamspaceId: placed.teamspaceId, properties: parsed.columns })
    .onConflictDoNothing({ target: [databaseDefinition.knowledgeBaseId, databaseDefinition.pageId] });
  const [definition] = await db.select({ columns: databaseDefinition.properties }).from(databaseDefinition)
    .where(and(eq(databaseDefinition.knowledgeBaseId, parsed.knowledgeBaseId), eq(databaseDefinition.pageId, parsed.id)));
  return { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.id, columns: definition!.columns };
}

/**
 * P03 必须先在数据库页面上校验至少 edit。行即页面:kind=row、父页面与 teamspace
 * 由所属数据库决定,行属性先按列 schema 验证(relation 值必须解析到目标数据库的
 * 现存行),再经 T01 创建路径落库(幂等 UUID、分数排序、权限围栏)。重复提交同一
 * id 返回现有落位;同 id 但指向其他数据库或非行页面被拒绝。
 */
export async function createAuthorizedRow(db: ResourceTransaction, input: unknown, createdBy: string): Promise<PagePlacement> {
  const parsed = parse(createRowInputSchema, input);
  if (!entityIdSchema.safeParse(createdBy).success) throw new FobDatabaseError('INVALID_DATABASE_INPUT');
  const database = await loadDatabase(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.databaseId });
  const [existing] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.id)));
  if (existing) {
    if (existing.kind !== 'row' || existing.databaseId !== parsed.databaseId) throw new FobDatabaseError('INVALID_DATABASE_INPUT');
    return placement(existing);
  }
  validateRowProperties(database.columns, parsed.properties);
  await assertRelationValues(db, parsed.knowledgeBaseId, database.columns, parsed.properties);
  const placed = await createAuthorizedPage(db, {
    id: parsed.id,
    knowledgeBaseId: parsed.knowledgeBaseId,
    teamspaceId: database.teamspaceId,
    parentId: parsed.databaseId,
    kind: 'row',
    databaseId: parsed.databaseId,
    properties: parsed.properties,
    title: parsed.title,
    icon: parsed.icon,
    cover: parsed.cover,
    inheritsPermissions: parsed.inheritsPermissions,
    afterPageId: parsed.afterPageId,
  }, createdBy);
  await emitRowsChanged(db, { knowledgeBaseId: parsed.knowledgeBaseId, databaseId: parsed.databaseId, ids: [parsed.id] });
  return placed;
}

/**
 * P03 必须先在行页面上校验至少 edit。属性整体替换,先按当前列 schema 验证再写入;
 * 与列变更在数据库页面行锁上串行,保证存储的行属性始终符合当前 schema。
 */
export async function updateAuthorizedRowProperties(db: ResourceTransaction, input: unknown): Promise<RowPropertiesState> {
  const parsed = parse(updatePropertiesInputSchema, input);
  const [row] = await db.select({ id: page.id, kind: page.kind, databaseId: page.databaseId, deletedAt: page.deletedAt }).from(page)
    .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.pageId)));
  if (!row || row.deletedAt !== null) throw new FobDatabaseError('ROW_NOT_FOUND');
  if (row.kind !== 'row' || row.databaseId === null) throw new FobDatabaseError('INVALID_DATABASE_INPUT');
  // 数据库页面锁把行属性写入与列变更(删列清洗/定义替换)互斥;knowledgeBase→teamspace→page
  // 的加锁顺序与 P03 既有协议一致。
  await lockPermissionPage(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: row.databaseId });
  const database = await loadDatabase(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: row.databaseId });
  validateRowProperties(database.columns, parsed.properties);
  await assertRelationValues(db, parsed.knowledgeBaseId, database.columns, parsed.properties);
  const updated = await db.update(page).set({ properties: parsed.properties, updatedAt: sql`clock_timestamp()` })
    .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.pageId), isNull(page.deletedAt)))
    .returning({ id: page.id });
  if (!updated.length) throw new FobDatabaseError('ROW_NOT_FOUND');
  await emitRowsChanged(db, { knowledgeBaseId: parsed.knowledgeBaseId, databaseId: row.databaseId, ids: [parsed.pageId] });
  return { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId, properties: parsed.properties };
}

/**
 * P03 必须先在数据库页面上校验 full(结构变更影响全部行)。列定义按 id 对齐整体
 * 替换:加列即时生效且存量行视为空值;删列在同一事务把该键从所有行(含已回收行)
 * 的属性中丢弃;改类型被显式拒绝;同类型的改名/选项调整接受,存量行中已失效的
 * 选项值保留原样、在下一次写入时被验证拒绝。
 */
export async function updateAuthorizedDatabaseColumns(db: ResourceTransaction, input: unknown): Promise<DatabaseColumnsState> {
  const parsed = parse(updateDatabaseColumnsInputSchema, input);
  await lockPermissionPage(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId });
  const database = await loadDatabase(db, parsed);
  const next = new Map(parsed.columns.map((column) => [column.id, column] as const));
  for (const previous of database.columns) {
    const updated = next.get(previous.id);
    if (updated && updated.type !== previous.type) throw new FobDatabaseError('INVALID_DATABASE_COLUMNS');
  }
  await assertRelationTargets(db, parsed.knowledgeBaseId, parsed.columns);
  if (database.columns.length === parsed.columns.length && database.columns.every((previous, index) => JSON.stringify(previous) === JSON.stringify(parsed.columns[index]))) {
    return { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId, columns: database.columns };
  }
  const removed = database.columns.filter((column) => !next.has(column.id)).map((column) => column.id);
  if (removed.length) {
    await db.update(page).set({ properties: sql`${page.properties} - ${sql.param(removed)}::text[]`, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.databaseId, parsed.pageId)));
  }
  await db.update(databaseDefinition).set({ properties: parsed.columns, updatedAt: sql`clock_timestamp()` })
    .where(and(eq(databaseDefinition.knowledgeBaseId, parsed.knowledgeBaseId), eq(databaseDefinition.pageId, parsed.pageId)));
  await emitColumnsChanged(db, parsed);
  return { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId, columns: parsed.columns };
}

/**
 * viewer 主体必须由调用方(P03)从已验证的成员/组/链接行展开后传入,绝不经请求体。
 * 行可见性走 effectivePageAccessCondition:物化权限滞后的行 fail closed。游标是行
 * 页面 ID,seek 谓词与排序全序同构;筛选与排序的列必须存在于当前列 schema。
 */
export async function listDatabaseRows(db: ResourceTransaction, input: unknown): Promise<DatabaseRowsPage> {
  const parsed = parse(listDatabaseRowsInputSchema, input);
  const database = await loadDatabase(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.databaseId });
  const conditions = [eq(page.databaseId, parsed.databaseId), effectivePageAccessCondition({ knowledgeBaseId: parsed.knowledgeBaseId, principals: parsed.viewer, required: 'view' })];
  const filter = compileRowFilters(database.columns, parsed.filters);
  if (filter) conditions.push(filter);
  if (parsed.cursor) {
    const [anchor] = await db.select({ id: page.id, position: page.position, properties: page.properties }).from(page)
      .where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.databaseId, parsed.databaseId), eq(page.id, parsed.cursor)));
    if (!anchor) throw new FobDatabaseError('INVALID_DATABASE_QUERY');
    conditions.push(compileRowSeek(database.columns, parsed.sort, anchor));
  }
  const found = await db.select({ pageId: page.id, title: page.title, properties: page.properties }).from(page)
    .where(and(...conditions)).orderBy(...compileRowOrder(database.columns, parsed.sort), asc(page.position), asc(page.id)).limit(parsed.limit + 1);
  const rows = found.slice(0, parsed.limit);
  return databaseRowsPageSchema.parse({ rows, nextCursor: found.length > parsed.limit ? rows[rows.length - 1]!.pageId : null });
}

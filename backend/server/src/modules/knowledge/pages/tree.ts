import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  createPageInputSchema,
  entityIdSchema,
  movePageInputSchema,
  pagePlacementSchema,
  propertiesSchema,
  recyclePageInputSchema,
  restorePageInputSchema,
} from '@fob/shared/knowledge/contracts';
import type { PageLifecycleState, PagePlacement } from '@fob/shared/knowledge/contracts';
import { page } from '../../../platform/database/resources/schema';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { lockPermissionPage } from '../permissions/locking';
import { withAuthorizedPageTreeMutation } from '../permissions/mutations';
import { KnowledgePageError } from './errors';
import { PositionExhaustedError, distributePositions, positionBetween } from './ordering';
import { recordSubscriptionChange, removeRecycledPageSubscriptions } from '../subscriptions/service';
import { appendKnowledgeOutbox } from '../workers/outbox';

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new KnowledgePageError('INVALID_PAGE_INPUT');
  return parsed.data;
}

const label = (pageId: string) => pageId.replaceAll('-', '_');
const placement = (row: { id: string; parentId: string | null; teamspaceId: string; position: string; path: string }): PagePlacement =>
  pagePlacementSchema.parse({ pageId: row.id, parentId: row.parentId, teamspaceId: row.teamspaceId, position: row.position, path: row.path });
const lifecycle = (row: { knowledgeBaseId: string; id: string; deletedAt: Date | null }): PageLifecycleState =>
  ({ knowledgeBaseId: row.knowledgeBaseId, pageId: row.id, deletedAt: row.deletedAt ? row.deletedAt.toISOString() : null });

type PlacementScope = { knowledgeBaseId: string; teamspaceId: string; parentId: string | null };
type ParentRow = { id: string; teamspaceId: string; path: string; deletedAt: Date | null };

/** 跨租户/跨 teamspace/已回收/不存在的父页面统一为 INVALID_PAGE_PARENT;租户上下文之外的父页在事务内不可见。 */
async function loadParent(db: ResourceTransaction, scope: { knowledgeBaseId: string; teamspaceId: string; parentId: string | null }): Promise<ParentRow | null> {
  if (scope.parentId === null) return null;
  const [parent] = await db.select({ id: page.id, teamspaceId: page.teamspaceId, path: page.path, deletedAt: page.deletedAt })
    .from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.parentId)));
  if (!parent || parent.deletedAt !== null || parent.teamspaceId !== scope.teamspaceId) throw new KnowledgePageError('INVALID_PAGE_PARENT');
  return parent;
}

/**
 * 在目标父节点下为页面分配排序键。读取发生在 withAuthorizedPageTreeMutation 的
 * 知识库锁内,并发插入串行化后总能看到最新兄弟集合;相邻中点插入不触发兄弟更新,
 * 仅在排序键耗尽或遇到非规范键时对该父节点的兄弟集合局部重排。
 */
async function allocatePosition(db: ResourceTransaction, scope: PlacementScope, afterPageId: string | null, movingPageId: string): Promise<string> {
  const parent = scope.parentId === null ? isNull(page.parentId) : eq(page.parentId, scope.parentId);
  const current = await db.select({ id: page.id, position: page.position }).from(page)
    .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.teamspaceId, scope.teamspaceId), parent, isNull(page.deletedAt), ne(page.id, movingPageId)))
    .orderBy(asc(page.position), asc(page.id));
  const anchor = afterPageId === null ? current.length - 1 : current.findIndex((row) => row.id === afterPageId);
  if (afterPageId !== null && anchor < 0) throw new KnowledgePageError('INVALID_PAGE_PLACEMENT');
  try {
    return positionBetween(current[anchor]?.position ?? null, current[anchor + 1]?.position ?? null);
  } catch (error) {
    if (!(error instanceof PositionExhaustedError)) throw error;
    const spread = distributePositions(current.length);
    await db.execute(sql`update ${page} set position = reassigned.position, updated_at = clock_timestamp()
      from unnest(${sql.param(current.map((row) => row.id))}::uuid[], ${sql.param(spread)}::text[]) as reassigned(id, position)
      where ${page.knowledgeBaseId} = ${scope.knowledgeBaseId} and ${page.id} = reassigned.id`);
    return positionBetween(spread[anchor] ?? null, spread[anchor + 1] ?? null);
  }
}

/**
 * P03 必须先在源子树根与目标父节点(移至根级时为目标 teamspace 根域)上以
 * authorizePageAccess 校验至少 edit 后才能调用本函数。显式 id 由客户端离线生成,
 * 服务端不生成 id;重复提交同一 id 按已存在处理并返回现有落位。落位发生在
 * withAuthorizedPageTreeMutation 边界内,新子树在同一事务中被围栏失效。
 */
export async function createAuthorizedPage(db: ResourceTransaction, input: unknown, createdBy: string): Promise<PagePlacement> {
  const parsed = parse(createPageInputSchema, input);
  if (!entityIdSchema.safeParse(createdBy).success) throw new KnowledgePageError('INVALID_PAGE_INPUT');
  let inserted = false;
  const { value } = await withAuthorizedPageTreeMutation(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.id }, async () => {
    const [existing] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, parsed.knowledgeBaseId), eq(page.id, parsed.id)));
    if (existing) return placement(existing);
    const parent = await loadParent(db, parsed);
    const position = await allocatePosition(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: parsed.teamspaceId, parentId: parsed.parentId }, parsed.afterPageId, parsed.id);
    const [created] = await db.insert(page).values({
      knowledgeBaseId: parsed.knowledgeBaseId,
      id: parsed.id,
      teamspaceId: parsed.teamspaceId,
      parentId: parsed.parentId,
      position,
      path: parent === null ? label(parsed.id) : `${parent.path}.${label(parsed.id)}`,
      kind: parsed.kind,
      databaseId: parsed.databaseId,
      properties: parsed.properties,
      title: parsed.title,
      icon: parsed.icon,
      cover: parsed.cover,
      inheritsPermissions: parsed.inheritsPermissions,
      createdBy,
    }).returning();
    inserted = true;
    return placement(created!);
  });
  if (inserted) for (const event of await recordSubscriptionChange(db, { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.id, actorId: createdBy, change: 'created' })) await appendKnowledgeOutbox(db, event);
  return value;
}

/**
 * P03 必须先按上述 createAuthorizedPage 的注释完成授权。子树移动在同一事务内更新
 * parentId/position/teamspace 不变式与根 path,子孙 path 由服务端经
 * `newPrefix || subpath(path, nlevel(oldPath))` 单语句推导;循环移动、跨租户/跨
 * teamspace 父子与非法 afterPageId 在任何写入前被拒绝,失败整体回滚。
 */
/**
 * P03 must authorize page-level `edit` before calling. Metadata updates
 * never touch ACLs, so no permission fence runs; the page.updated knowledgeBase
 * event lets tree UIs refetch. Title changes refresh derived title paths on
 * the next body change (H01 contract).
 */
const pagePatchSchema = z.strictObject({
  knowledgeBaseId: z.string().uuid(),
  pageId: z.string().uuid(),
  patch: z.strictObject({
    title: z.string().max(500).optional(),
    properties: propertiesSchema.optional(),
    icon: z.string().max(200).nullable().optional(),
    cover: z.string().max(2048).nullable().optional(),
  }).refine((value) => Object.keys(value).length > 0, 'at least one field'),
});

export async function updateAuthorizedPage(db: ResourceTransaction, input: unknown, actorId?: string): Promise<PagePlacement> {
  const parsed = parse(pagePatchSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const node = await lockPermissionPage(db, scope);
  if (!node || node.deletedAt !== null) throw new KnowledgePageError('PAGE_NOT_FOUND');
  await db.update(page).set({ ...parsed.patch, updatedAt: sql`clock_timestamp()` })
    .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  const renamed = parsed.patch.title !== undefined && parsed.patch.title !== node.title;
  const isFile = typeof node.properties.fileAsset === 'string' || typeof parsed.patch.properties?.fileAsset === 'string';
  const fileChanged = isFile && Object.entries(parsed.patch).some(([key, value]) => !isDeepStrictEqual(value, node[key as keyof typeof node]));
  if (actorId && (renamed || fileChanged)) for (const event of await recordSubscriptionChange(db, { ...scope, actorId, change: fileChanged && !renamed ? 'file.changed' : 'renamed' })) await appendKnowledgeOutbox(db, event);
  return placement({ ...node, ...parsed.patch });
}

export async function moveAuthorizedPage(db: ResourceTransaction, input: unknown): Promise<PagePlacement> {
  const parsed = parse(movePageInputSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const { value } = await withAuthorizedPageTreeMutation(db, scope, async () => {
    const node = await lockPermissionPage(db, scope);
    if (!node || node.deletedAt !== null) throw new KnowledgePageError('PAGE_NOT_FOUND');
    if (parsed.teamspaceId !== node.teamspaceId) throw new KnowledgePageError('INVALID_PAGE_MOVE');
    const parent = await loadParent(db, parsed);
    if (parent !== null && (parent.id === node.id || parent.path === node.path || parent.path.startsWith(`${node.path}.`))) throw new KnowledgePageError('INVALID_PAGE_MOVE');
    const position = await allocatePosition(db, { knowledgeBaseId: parsed.knowledgeBaseId, teamspaceId: node.teamspaceId, parentId: parsed.parentId }, parsed.afterPageId, node.id);
    const path = parent === null ? label(node.id) : `${parent.path}.${label(node.id)}`;
    if (node.parentId === parsed.parentId && node.position === position && node.path === path) return placement(node);
    // 节点自身的 parentId 与 path 必须同语句更新:分步写会中途违反
    // page_root_path_depth(parent 与深度互斥)不变式。子孙的 path 前缀推导为
    // 第二条语句,严格更深,subpath 偏移必然合法。
    await db.update(page).set({ parentId: parsed.parentId, position, path: sql`${path}::ltree`, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    await db.update(page).set({ path: sql`${path}::ltree || subpath(${page.path}, nlevel(${node.path}::ltree))`, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), sql`${page.path} <@ ${node.path}::ltree`, ne(page.id, node.id)));
    return { pageId: node.id, parentId: parsed.parentId, teamspaceId: node.teamspaceId, position, path };
  });
  return value;
}

/**
 * P03 授权前置同上。软删除仅标记根节点:子孙行保持原位,回收后整棵子树经 P02
 * 物化为空并 fail closed;恢复清除标记并在同一事务内重新围栏,等待重算后重新可见。
 */
export async function recycleAuthorizedPage(db: ResourceTransaction, input: unknown): Promise<PageLifecycleState> {
  const parsed = parse(recyclePageInputSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const { value } = await withAuthorizedPageTreeMutation(db, scope, async () => {
    const node = await lockPermissionPage(db, scope);
    if (!node) throw new KnowledgePageError('PAGE_NOT_FOUND');
    if (node.deletedAt !== null) return lifecycle(node);
    await removeRecycledPageSubscriptions(db, scope, node.path);
    const [updated] = await db.update(page).set({ deletedAt: sql`clock_timestamp()`, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId))).returning({ deletedAt: page.deletedAt });
    return { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, deletedAt: updated!.deletedAt!.toISOString() };
  });
  return value;
}

/** P03 授权前置同上;恢复被回收的页面,谱系中仍有回收祖先时可见性由 P02 决定。 */
export async function restoreAuthorizedPage(db: ResourceTransaction, input: unknown): Promise<PageLifecycleState> {
  const parsed = parse(restorePageInputSchema, input);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.pageId };
  const { value } = await withAuthorizedPageTreeMutation(db, scope, async () => {
    const node = await lockPermissionPage(db, scope);
    if (!node) throw new KnowledgePageError('PAGE_NOT_FOUND');
    if (node.deletedAt === null) return lifecycle(node);
    await db.update(page).set({ deletedAt: null, updatedAt: sql`clock_timestamp()` })
      .where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
    return { knowledgeBaseId: scope.knowledgeBaseId, pageId: scope.pageId, deletedAt: null };
  });
  return value;
}

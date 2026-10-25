import { randomUUID } from 'node:crypto';
import { and, asc, eq, gt, ilike, inArray, or } from 'drizzle-orm';
import type { JSONContent } from '@tiptap/core';
import {
  createKnowledgeTemplateInputSchema, createPageFromTemplateInputSchema, knowledgeTemplateScopeSchema,
  listKnowledgeTemplatesInputSchema, materializeKnowledgeTemplateDocument, updateKnowledgeTemplateInputSchema,
} from '@fob/shared/knowledge/templates';
import type { KnowledgeTemplateSummary } from '@fob/shared/knowledge/templates';
import { principal } from '@fob/shared/knowledge/contracts';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import { asset, docState, member, page, pageAcl, teamspace } from '../../../platform/database/resources/schema';
import { knowledgeTemplate } from '../../../platform/database/resources/schema/knowledge-templates';
import type { ResourceTransaction } from '../../../platform/database/resources/transaction';
import { ResourceRequestError, parseInput } from '../../../platform/resources/errors';
import { requireKnowledgeScopes } from '../access';
import type { KnowledgeRequestContext } from '../access';
import { authorizePageAccess, effectivePageAccessCondition, expandRequestPrincipals, lockPermissionKnowledgeBase } from '../permissions';
import { rebuildPermissionSubtree } from '../permissions/rebuild';
import { createAuthorizedPage } from '../pages/tree';
import { collectAssetReferences } from '../import-export/body';
import { prosemirrorDocToYDoc, yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { appendKnowledgeOutbox } from '../workers/outbox';
import { KnowledgeTemplateError } from './errors';

type Template = typeof knowledgeTemplate.$inferSelect;
const unavailable = () => new KnowledgeTemplateError('TEMPLATE_NOT_FOUND', 'Template is not available.', 404);
const forbidden = () => new ResourceRequestError('FORBIDDEN', 'This operation is not allowed.', 403);

async function actor(db: ResourceTransaction, authority: KnowledgeRequestContext, write: boolean) {
  requireKnowledgeScopes(authority, write ? ['read', 'write'] : ['read']);
  if (write) await lockPermissionKnowledgeBase(db, authority.knowledgeBaseId);
  const [record] = await db.select().from(member).where(and(eq(member.knowledgeBaseId, authority.knowledgeBaseId), eq(member.userId, authority.userId)));
  if (!record) throw unavailable();
  return record;
}
const manages = (row: Template, userId: string, role: string) => row.createdBy === userId || role === 'owner' || role === 'admin';
function summary(row: Template, userId: string, role: string): KnowledgeTemplateSummary {
  return { knowledgeBaseId: row.knowledgeBaseId, id: row.id, sourcePageId: row.sourcePageId, name: row.name, description: row.description,
    title: row.title, icon: row.icon, createdBy: row.createdBy, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), canManage: manages(row, userId, role) };
}
async function visibleTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, templateId: string) {
  const [record] = await db.select().from(knowledgeTemplate).where(and(eq(knowledgeTemplate.knowledgeBaseId, authority.knowledgeBaseId), eq(knowledgeTemplate.id, templateId)));
  if (!record || (await authorizePageAccess(db, { userId: authority.userId, scope: { knowledgeBaseId: authority.knowledgeBaseId, pageId: record.sourcePageId }, required: 'view' })).decision !== 'allow') throw unavailable();
  return record;
}
function documentFromSnapshot(document: JSONContent) {
  try {
    const result = knowledgeSchema.nodeFromJSON(document);
    result.check();
    return result;
  } catch { throw new ResourceRequestError('INVALID_INPUT', 'Invalid template document.', 400); }
}
function independentDocument(document: JSONContent) {
  try { return documentFromSnapshot(materializeKnowledgeTemplateDocument(document)); }
  catch { throw new ResourceRequestError('INVALID_INPUT', 'Invalid template document.', 400); }
}
async function verifyAttachments(db: ResourceTransaction, knowledgeBaseId: string, document: ReturnType<typeof documentFromSnapshot>, decoration: (string | null)[] = []) {
  const hashes = [...new Set([...collectAssetReferences(document), ...decoration.filter((value): value is string => typeof value === 'string' && /^asset:[a-f0-9]{64}$/.test(value)).map((value) => value.slice(6))])];
  if (!hashes.length) return;
  const rows = await db.select({ hash: asset.hash }).from(asset).where(and(eq(asset.knowledgeBaseId, knowledgeBaseId), inArray(asset.hash, hashes), eq(asset.status, 'ready')));
  if (new Set(rows.map((row) => row.hash)).size !== new Set(hashes).size) throw new KnowledgeTemplateError('TEMPLATE_ASSET_UNAVAILABLE', 'A template attachment is no longer available.', 409);
}

export async function listKnowledgeTemplates(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(listKnowledgeTemplatesInputSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, false);
  const principals = await expandRequestPrincipals(db, parsed.knowledgeBaseId, authority.userId);
  const search = `%${parsed.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
  const rows = await db.select({ template: knowledgeTemplate }).from(knowledgeTemplate)
    .innerJoin(page, and(eq(page.knowledgeBaseId, knowledgeTemplate.knowledgeBaseId), eq(page.id, knowledgeTemplate.sourcePageId)))
    .where(and(eq(knowledgeTemplate.knowledgeBaseId, parsed.knowledgeBaseId), effectivePageAccessCondition({ knowledgeBaseId: parsed.knowledgeBaseId, principals, required: 'view' }),
      parsed.cursor ? gt(knowledgeTemplate.id, parsed.cursor) : undefined,
      parsed.q ? or(ilike(knowledgeTemplate.name, search), ilike(knowledgeTemplate.description, search), ilike(knowledgeTemplate.title, search)) : undefined))
    .orderBy(asc(knowledgeTemplate.id)).limit(parsed.limit + 1);
  return { items: rows.slice(0, parsed.limit).map(({ template }) => summary(template, authority.userId, membership.role)), nextCursor: rows.length > parsed.limit ? rows[parsed.limit - 1]!.template.id : null };
}

export async function saveKnowledgeTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(createKnowledgeTemplateInputSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, true);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.sourcePageId };
  if ((await authorizePageAccess(db, { userId: authority.userId, scope, required: 'edit' })).decision !== 'allow') throw unavailable();
  const [source] = await db.select().from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  if (source?.kind !== 'doc' || source.properties.fileAsset) throw new KnowledgeTemplateError('TEMPLATE_REQUIRES_DOCUMENT', 'Only an article can be saved as a template.', 400);
  const [stored] = await db.select().from(docState).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
  const document = stored ? yStateToProseMirrorDoc(new Uint8Array(stored.state), knowledgeSchema) : null;
  const snapshot = independentDocument(parsed.document ?? (document ?? knowledgeSchema.topNodeType.createAndFill()!).toJSON() as JSONContent);
  snapshot.check();
  await verifyAttachments(db, scope.knowledgeBaseId, snapshot, [source.icon, source.cover]);
  const [created] = await db.insert(knowledgeTemplate).values({ knowledgeBaseId: scope.knowledgeBaseId, id: randomUUID(), sourcePageId: scope.pageId,
    name: parsed.name, description: parsed.description, title: source.title, icon: source.icon, cover: source.cover,
    document: snapshot.toJSON() as JSONContent, createdBy: authority.userId }).returning();
  return summary(created!, authority.userId, membership.role);
}

export async function getKnowledgeTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(knowledgeTemplateScopeSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, false);
  const row = await visibleTemplate(db, authority, parsed.templateId);
  return { template: summary(row, authority.userId, membership.role), document: row.document };
}

export async function updateKnowledgeTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(updateKnowledgeTemplateInputSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, true);
  const row = await visibleTemplate(db, authority, parsed.templateId);
  if (!manages(row, authority.userId, membership.role)) throw forbidden();
  const [updated] = await db.update(knowledgeTemplate).set({ ...(parsed.name === undefined ? {} : { name: parsed.name }), ...(parsed.description === undefined ? {} : { description: parsed.description }), updatedAt: new Date() })
    .where(and(eq(knowledgeTemplate.knowledgeBaseId, parsed.knowledgeBaseId), eq(knowledgeTemplate.id, parsed.templateId))).returning();
  return summary(updated!, authority.userId, membership.role);
}

export async function removeKnowledgeTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(knowledgeTemplateScopeSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, true);
  const row = await visibleTemplate(db, authority, parsed.templateId);
  if (!manages(row, authority.userId, membership.role)) throw forbidden();
  await db.delete(knowledgeTemplate).where(and(eq(knowledgeTemplate.knowledgeBaseId, parsed.knowledgeBaseId), eq(knowledgeTemplate.id, parsed.templateId)));
  return { removed: true as const };
}

export async function createPageFromKnowledgeTemplate(db: ResourceTransaction, authority: KnowledgeRequestContext, input: unknown) {
  const parsed = parseInput(createPageFromTemplateInputSchema, input);
  if (parsed.knowledgeBaseId !== authority.knowledgeBaseId) throw unavailable();
  const membership = await actor(db, authority, true);
  const row = await visibleTemplate(db, authority, parsed.templateId);
  const scope = { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.id };
  const [existing] = await db.select({ id: page.id }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  if (existing) throw new KnowledgeTemplateError('PAGE_ALREADY_EXISTS', 'The destination document already exists.', 409);
  if (parsed.parentId) {
    if ((await authorizePageAccess(db, { userId: authority.userId, scope: { knowledgeBaseId: parsed.knowledgeBaseId, pageId: parsed.parentId }, required: 'edit' })).decision !== 'allow') throw forbidden();
  } else {
    const [folder] = await db.select().from(teamspace).where(and(eq(teamspace.knowledgeBaseId, parsed.knowledgeBaseId), eq(teamspace.id, parsed.teamspaceId)));
    if (!folder) throw unavailable();
    if (!['owner', 'admin'].includes(membership.role) && !['edit', 'full'].includes(folder.defaultAccess ?? '')) throw forbidden();
  }
  const document = independentDocument(row.document);
  await verifyAttachments(db, parsed.knowledgeBaseId, document, [row.icon, row.cover]);
  const placed = await createAuthorizedPage(db, { knowledgeBaseId: parsed.knowledgeBaseId, id: parsed.id, teamspaceId: parsed.teamspaceId,
    parentId: parsed.parentId, title: parsed.title ?? row.title, kind: 'doc', databaseId: null, properties: {}, icon: row.icon, cover: row.cover, inheritsPermissions: true, afterPageId: null }, authority.userId);
  await db.insert(pageAcl).values({ ...scope, principal: principal('user', authority.userId), level: 'full', inherited: false });
  const encoded = prosemirrorDocToYDoc(document);
  try { await db.insert(docState).values({ ...scope, state: Buffer.from(encoded.state), stateVector: Buffer.from(encoded.stateVector) }); }
  finally { encoded.ydoc.destroy(); }
  const [record] = await db.select({ revision: page.aclRevision }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
  await rebuildPermissionSubtree(db, { topic: 'acl.changed', knowledgeBaseId: scope.knowledgeBaseId, rootPageId: scope.pageId, revision: record!.revision });
  // Initial body indexing uses the same authoritative outbox as collaboration and imports.
  await appendKnowledgeOutbox(db, { topic: 'doc.changed', ...scope, actor: authority.actor, occurredAt: new Date().toISOString() });
  return placed;
}

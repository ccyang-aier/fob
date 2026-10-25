import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { assetHashSchema, documentInviteAcceptSchema, entityIdSchema, pageScopeSchema, shareTokenSchema } from '@fob/shared/knowledge/contracts';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { documentInvitation } from '../../../platform/database/resources/schema';
import { requireFobIdentity } from '../../../platform/identity/identity';
import type { FobIdentity } from '../../../platform/identity/identity';
import type { KnowledgeAccessDependencies } from '../access';
import { activeSessionMember } from '../access/session-access';
import { knowledgeAccessErrorResponse } from '../access';
import { lockPermissionKnowledgeBase, KnowledgePermissionError } from '../permissions';
import { resourceFailure } from '../../../platform/resources/errors';
import { sharingErrorResponse, KnowledgeSharingError } from '../sharing/errors';
import { shareLinkLocator } from '../sharing/links';
import { knowledgeAssetStorage } from '../assets/runtime';
import { DocumentServiceError, changeDocumentInheritance, changeDocumentPermission, documentDirectory, readDocumentSharing, requireDocument } from './service';
import { changeDocumentPublication, readPublicDocument, requirePublicAsset } from './publication';
import { readDocumentStatistics, recordDocumentVisit } from './statistics';
import { acceptDocumentInvitation, inviteToDocument } from './invitations';

type Environment = { Variables: { identity: FobIdentity } };
export function createDocumentCollaborationRoutes(deps: KnowledgeAccessDependencies & { publicationSecret: string; onPermissionsChanged?: (knowledgeBaseId: string) => Promise<void> }) {
  const app = new Hono<Environment>();
  const base = '/api/knowledge/:knowledgeBaseId/pages/:pageId/collaboration';
  const accept = '/api/document-invitations/accept';
  const publicBase = '/api/public/documents';
  const origins = deps.auth.options.trustedOrigins as string[];
  for (const pattern of [`${base}*`, accept, `${publicBase}*`]) {
    app.use(pattern, cors({ origin: origin => origins.includes(origin) ? origin : undefined, credentials: true,
      allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
    app.use(pattern, bodyLimit({ maxSize: 64 * 1024 }));
    app.use(pattern, async (context, next) => {
      context.header('Cache-Control', 'no-store'); context.header('Referrer-Policy', 'no-referrer');
      context.header('X-Content-Type-Options', 'nosniff');
      if (!['GET', 'OPTIONS'].includes(context.req.method) && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE' }, 415);
      await next();
    });
  }
  app.use(`${base}*`, requireFobIdentity(deps.auth));
  app.use(accept, requireFobIdentity(deps.auth));
  async function input(request: { json: () => Promise<unknown> }) {
    try { return await request.json(); } catch { throw new DocumentServiceError(400, 'INVALID_INPUT'); }
  }
  const scopeOf = (params: Record<string, string>) => { const result = pageScopeSchema.safeParse({ knowledgeBaseId: params.knowledgeBaseId, pageId: params.pageId }); if (!result.success) throw new DocumentServiceError(400, 'INVALID_INPUT'); return result.data; };
  app.get(base, async context => {
    const scope = scopeOf(context.req.param());
    return context.json(await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async db => {
      await activeSessionMember(db, scope.knowledgeBaseId, context.get('identity'));
      return readDocumentSharing(db, scope, context.get('identity').userId, deps.publicationSecret);
    }));
  });
  app.get(`${base}/directory`, async context => {
    const scope = scopeOf(context.req.param());
    return context.json(await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async db => {
      await activeSessionMember(db, scope.knowledgeBaseId, context.get('identity'));
      return documentDirectory(db, scope, context.get('identity').userId, context.req.query('q') ?? '');
    }));
  });
  for (const operation of ['permissions', 'inheritance', 'publication', 'invitations', 'visits'] as const) app.post(`${base}/${operation}`, async context => {
    const scope = scopeOf(context.req.param()), identity = context.get('identity'), body = await input(context.req);
    const result = await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async db => {
      await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
      await activeSessionMember(db, scope.knowledgeBaseId, identity, true);
      if (operation === 'permissions') return changeDocumentPermission(db, scope, identity.userId, body);
      if (operation === 'publication') return changeDocumentPublication(db, scope, identity.userId, deps.publicationSecret, body);
      if (operation === 'invitations') return inviteToDocument(db, scope, identity, body);
      if (operation === 'visits') return recordDocumentVisit(db, scope, identity.userId);
      const parsed = z.object({ inheritsPermissions: z.boolean() }).safeParse(body);
      if (!parsed.success) throw new DocumentServiceError(400, 'INVALID_INPUT');
      return changeDocumentInheritance(db, scope, identity.userId, parsed.data.inheritsPermissions);
    });
    if (operation !== 'visits' && operation !== 'invitations') await deps.onPermissionsChanged?.(scope.knowledgeBaseId);
    return context.json(result);
  });
  app.delete(`${base}/invitations/:invitationId`, async context => {
    const scope = scopeOf(context.req.param()), id = entityIdSchema.safeParse(context.req.param('invitationId'));
    if (!id.success) throw new DocumentServiceError(400, 'INVALID_INPUT');
    return context.json(await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async db => {
      await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
      await activeSessionMember(db, scope.knowledgeBaseId, context.get('identity'), true);
      await requireDocument(db, scope, context.get('identity').userId, 'full');
      await db.update(documentInvitation).set({ revokedAt: new Date() }).where(and(eq(documentInvitation.knowledgeBaseId, scope.knowledgeBaseId), eq(documentInvitation.pageId, scope.pageId), eq(documentInvitation.id, id.data)));
      return { revoked: true };
    }));
  });
  app.get(`${base}/statistics`, async context => {
    const scope = scopeOf(context.req.param());
    return context.json(await withKnowledgeBase(deps.pool, scope.knowledgeBaseId, async db => {
      await activeSessionMember(db, scope.knowledgeBaseId, context.get('identity'));
      return readDocumentStatistics(db, scope, context.get('identity').userId);
    }));
  });
  app.post(accept, async context => {
    const parsed = documentInviteAcceptSchema.safeParse(await input(context.req));
    if (!parsed.success) throw new DocumentServiceError(404);
    return context.json(await withKnowledgeBase(deps.pool, parsed.data.knowledgeBaseId, db => acceptDocumentInvitation(db, context.get('identity'), parsed.data)));
  });
  app.post(publicBase, async context => {
    const parsed = z.object({ token: shareTokenSchema }).safeParse(await input(context.req));
    if (!parsed.success) throw new DocumentServiceError(404);
    const locator = shareLinkLocator(parsed.data.token)!;
    const result = await withKnowledgeBase(deps.pool, locator.knowledgeBaseId, db => readPublicDocument(db, parsed.data.token));
    return context.json({ title: result.title, body: result.body, updatedAt: result.updatedAt, assets: Object.fromEntries([...result.hashes].map(hash => [hash, hash])) });
  });
  app.post(`${publicBase}/assets/:hash`, async context => {
    const parsed = z.object({ token: shareTokenSchema }).safeParse(await input(context.req)), hash = assetHashSchema.safeParse(context.req.param('hash'));
    if (!parsed.success || !hash.success) throw new DocumentServiceError(404);
    const locator = shareLinkLocator(parsed.data.token)!;
    const target = await withKnowledgeBase(deps.pool, locator.knowledgeBaseId, db => requirePublicAsset(db, parsed.data.token, hash.data));
    const object = await knowledgeAssetStorage().openObject(target, context.req.raw.signal);
    if (!object.ok) throw new DocumentServiceError(503);
    return new Response(object.body, { headers: { 'Content-Type': target.mime, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' } });
  });
  app.onError(error => {
    if (error instanceof DocumentServiceError) return Response.json({ code: error.code }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    if (error instanceof KnowledgeSharingError) return sharingErrorResponse(error);
    if (error instanceof KnowledgePermissionError) return Response.json({ code: 'INVALID_PERMISSION_INPUT' }, { status: 400 });
    const failure = resourceFailure(error);
    if (failure) return Response.json({ code: failure.code }, { status: failure.status });
    return knowledgeAccessErrorResponse(error);
  });
  return app;
}

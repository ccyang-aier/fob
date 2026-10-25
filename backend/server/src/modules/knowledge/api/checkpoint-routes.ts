import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { and, desc, eq, sql } from 'drizzle-orm';
import { entityIdSchema, pageScopeSchema } from '@fob/shared/knowledge/contracts';
import { compareDocumentBlocks } from '@fob/shared/knowledge/document-insights';
import { knowledgeSchema } from '@fob/shared/knowledge/schema';
import type { Context } from 'hono';
import type { Pool } from 'pg';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { requireFobIdentity } from '../../../platform/identity/identity';
import type { FobIdentity } from '../../../platform/identity/identity';
import type { FobAuth } from '../../../platform/identity/service';
import { authorizePageAccess, lockPermissionKnowledgeBase } from '../permissions';
import { listPageCheckpointPage, readPageCheckpoint } from '../collaboration/history';
import { PageHistoryError } from '../collaboration/history';
import { CheckpointLabelError } from '../collaboration/checkpoints';
import type { PageCheckpointExtension } from '../collaboration/checkpoints';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { docCheckpoint, docState, page } from '../../../platform/database/resources/schema';
import { activeSessionMember } from '../access/session-access';
import { yStateToProseMirrorDoc } from '../import-export/y-encoding';
import { updateAuthorizedPage } from '../pages/tree';

type CheckpointEnvironment = { Variables: { identity: FobIdentity } };
const base = '/api/knowledge/:knowledgeBaseId/pages/:pageId/checkpoints';

/**
 * Page history uses P03 for list, preview and comparison. Naming and restoring
 * require edit access; restore rechecks the live session under the permission
 * lock and persists the collaboration state before acknowledging success.
 */
export function createKnowledgeCheckpointRoutes(dependencies: {
  auth: FobAuth;
  pool: Pool;
  /** The collaboration host's checkpoint extension; absent hosts cannot name versions. */
  checkpoints?: PageCheckpointExtension;
}): Hono<CheckpointEnvironment> {
  const app = new Hono<CheckpointEnvironment>();
  const origins = dependencies.auth.options.trustedOrigins as string[];

  app.use(`${base}*`, cors({ origin: origin => origins.includes(origin) ? origin : undefined, credentials: true, allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['Content-Type'] }));
  app.use(`${base}*`, bodyLimit({ maxSize: 16 * 1024 }));

  app.use(`${base}/*`, async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    if (!hasTrustedFobOrigin(context.req.raw, origins)) return context.json({ code: 'INVALID_ORIGIN', message: 'A trusted Origin is required.' }, 403);
    await next();
  });
  app.use(`${base}/*`, requireFobIdentity(dependencies.auth));

  async function authorize(context: Context<CheckpointEnvironment>, required: 'view' | 'edit') {
    const { knowledgeBaseId, pageId } = context.req.param();
    const scope = { knowledgeBaseId: knowledgeBaseId!, pageId: pageId! };
    if (!pageScopeSchema.safeParse(scope).success) return context.json({ code: 'INVALID_INPUT' }, 400);
    const decision = await withKnowledgeBase(dependencies.pool, knowledgeBaseId!, (db) =>
      authorizePageAccess(db, { userId: context.get('identity').userId, scope, required }));
    if (decision.decision !== 'allow') return context.json({ code: 'FORBIDDEN', message: 'This page history is not available at this permission level.' }, 403);
    return scope;
  }

  app.get(`${base}`, async (context) => {
    const scope = await authorize(context, 'view');
    if (scope instanceof Response) return scope;
    const cursor = context.req.query('cursor');
    if (cursor && !entityIdSchema.safeParse(cursor).success) return context.json({ code: 'INVALID_INPUT' }, 400);
    try { return context.json(await listPageCheckpointPage(dependencies.pool, scope, cursor)); }
    catch (error) {
      if (error instanceof PageHistoryError) return context.json({ code: error.code }, 404);
      return context.json({ code: 'HISTORY_UNAVAILABLE', message: 'Page history is temporarily unavailable.' }, 503);
    }
  });

  app.get(`${base}/:checkpointId`, async (context) => {
    const scope = await authorize(context, 'view');
    if (scope instanceof Response) return scope;
    if (!entityIdSchema.safeParse(context.req.param('checkpointId')).success) return context.json({ code: 'CHECKPOINT_NOT_FOUND' }, 404);
    try {
      return context.json(await readPageCheckpoint(dependencies.pool, scope, context.req.param('checkpointId')!));
    } catch (error) {
      if (error instanceof PageHistoryError) {
        const status = error.code === 'CHECKPOINT_NOT_FOUND' ? 404 : 503;
        return context.json({ code: error.code, message: error.message }, status);
      }
      return context.json({ code: 'HISTORY_UNAVAILABLE', message: 'Page history is temporarily unavailable.' }, 503);
    }
  });

  app.get(`${base}/:checkpointId/compare`, async context => {
    const scope = await authorize(context, 'view');
    if (scope instanceof Response) return scope;
    const id = context.req.param('checkpointId')!, reference = context.req.query('with') ?? 'previous';
    if (!entityIdSchema.safeParse(id).success || !['previous', 'current'].includes(reference) && !entityIdSchema.safeParse(reference).success) return context.json({ code: 'INVALID_INPUT' }, 400);
    try {
      const selected = await readPageCheckpoint(dependencies.pool, scope, id);
      let before: unknown = { type: 'doc', content: [] }, after: unknown = selected.body;
      let beforeTitle: string | null = null, afterTitle = selected.title ?? null;
      if (reference === 'current') {
        before = selected.body; beforeTitle = selected.title ?? null;
        const current = await withKnowledgeBase(dependencies.pool, scope.knowledgeBaseId, async db => {
          const [metadata] = await db.select({ title: page.title }).from(page).where(and(eq(page.knowledgeBaseId, scope.knowledgeBaseId), eq(page.id, scope.pageId)));
          const [state] = await db.select().from(docState).where(and(eq(docState.knowledgeBaseId, scope.knowledgeBaseId), eq(docState.pageId, scope.pageId)));
          return { title: metadata?.title ?? '', body: state ? yStateToProseMirrorDoc(state.state, knowledgeSchema)?.toJSON() : { type: 'doc', content: [] } };
        });
        after = current.body; afterTitle = current.title;
      } else {
        const previousId = reference !== 'previous' ? reference : await withKnowledgeBase(dependencies.pool, scope.knowledgeBaseId, async db => {
          const [previous] = await db.select({ id: docCheckpoint.id }).from(docCheckpoint).where(and(eq(docCheckpoint.knowledgeBaseId, scope.knowledgeBaseId), eq(docCheckpoint.pageId, scope.pageId),
            sql`(${docCheckpoint.createdAt}, ${docCheckpoint.id}) < (${selected.createdAt}::timestamptz, ${id}::uuid)`)).orderBy(desc(docCheckpoint.createdAt), desc(docCheckpoint.id)).limit(1);
          return previous?.id;
        });
        if (previousId) { const previous = await readPageCheckpoint(dependencies.pool, scope, previousId); before = previous.body; beforeTitle = previous.title ?? null; }
      }
      return context.json({ differences: compareDocumentBlocks(before, after), beforeTitle, afterTitle });
    } catch { return context.json({ code: 'CHECKPOINT_NOT_FOUND' }, 404); }
  });

  app.post(`${base}/:checkpointId/restore`, async context => {
    const scope = await authorize(context, 'edit');
    if (scope instanceof Response) return scope;
    const id = context.req.param('checkpointId')!;
    if (!entityIdSchema.safeParse(id).success) return context.json({ code: 'CHECKPOINT_NOT_FOUND' }, 404);
    if (!dependencies.checkpoints) return context.json({ code: 'HISTORY_UNAVAILABLE' }, 503);
    try {
      await readPageCheckpoint(dependencies.pool, scope, id);
      const identity = context.get('identity');
      const result = await dependencies.checkpoints.restoreCheckpoint(scope, id, { kind: 'human', userId: identity.userId }, async (mutate, title) => withKnowledgeBase(dependencies.pool, scope.knowledgeBaseId, async db => {
        await lockPermissionKnowledgeBase(db, scope.knowledgeBaseId);
        await activeSessionMember(db, scope.knowledgeBaseId, identity, true);
        if ((await authorizePageAccess(db, { userId: identity.userId, scope, required: 'edit' })).decision !== 'allow') throw new Error('Forbidden');
        if (title !== null) await updateAuthorizedPage(db, { ...scope, patch: { title } }, identity.userId);
        mutate();
      }));
      const current = await dependencies.checkpoints.createNamedCheckpoint(scope, 'Restored version');
      return context.json({ restored: true, ...result, checkpointId: current.checkpointId });
    } catch { return context.json({ code: 'HISTORY_UNAVAILABLE' }, 503); }
  });

  app.post(`${base}`, async (context) => {
    const scope = await authorize(context, 'edit');
    if (scope instanceof Response) return scope;
    if (context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    }
    const body = await context.req.json().catch(() => null) as { label?: unknown } | null;
    if (!body || typeof body.label !== 'string') return context.json({ code: 'INVALID_INPUT', message: 'A label string is required.' }, 400);
    if (!dependencies.checkpoints) return context.json({ code: 'HISTORY_UNAVAILABLE', message: 'The collaboration host is not running.' }, 503);
    try {
      const result = await dependencies.checkpoints.createNamedCheckpoint(scope, body.label);
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof CheckpointLabelError) {
        const reason = error.reason === 'empty' ? 'EMPTY_LABEL' : 'LABEL_TOO_LONG';
        return context.json({ code: reason, message: error.message }, 400);
      }
      return context.json({ code: 'HISTORY_UNAVAILABLE', message: 'Naming a version is temporarily unavailable.' }, 503);
    }
  });

  return app;
}

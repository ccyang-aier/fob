import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Pool } from 'pg';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { requireFobIdentity } from '../../../platform/identity/identity';
import type { FobIdentity } from '../../../platform/identity/identity';
import type { FobAuth } from '../../../platform/identity/service';
import { authorizePageAccess } from '../permissions';
import { listPageCheckpoints, readPageCheckpoint } from '../collaboration/history';
import { PageHistoryError } from '../collaboration/history';
import { CheckpointLabelError } from '../collaboration/checkpoints';
import type { PageCheckpointExtension } from '../collaboration/checkpoints';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';

type CheckpointEnvironment = { Variables: { identity: FobIdentity } };
const base = '/api/knowledge/:knowledgeBaseId/pages/:pageId/checkpoints';

/**
 * V03 history surface: read access serves the panel (list + preview), edit
 * access is required to name the current state. Restore is intentionally
 * absent — it is a client-side ProseMirror transaction on the live document.
 * P03 is the single ACL entry: one authorizePageAccess per request.
 */
export function createKnowledgeCheckpointRoutes(dependencies: {
  auth: FobAuth;
  pool: Pool;
  /** The collaboration host's checkpoint extension; absent hosts cannot name versions. */
  checkpoints?: PageCheckpointExtension;
}): Hono<CheckpointEnvironment> {
  const app = new Hono<CheckpointEnvironment>();
  const origins = dependencies.auth.options.trustedOrigins as string[];

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
    const decision = await withKnowledgeBase(dependencies.pool, knowledgeBaseId!, (db) =>
      authorizePageAccess(db, { userId: context.get('identity').userId, scope, required }));
    if (decision.decision !== 'allow') return context.json({ code: 'FORBIDDEN', message: 'This page history is not available at this permission level.' }, 403);
    return scope;
  }

  app.get(`${base}`, async (context) => {
    const scope = await authorize(context, 'view');
    if (scope instanceof Response) return scope;
    try { return context.json({ checkpoints: await listPageCheckpoints(dependencies.pool, scope) }); }
    catch { return context.json({ code: 'HISTORY_UNAVAILABLE', message: 'Page history is temporarily unavailable.' }, 503); }
  });

  app.get(`${base}/:checkpointId`, async (context) => {
    const scope = await authorize(context, 'view');
    if (scope instanceof Response) return scope;
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

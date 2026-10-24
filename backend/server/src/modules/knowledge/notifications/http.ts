import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import type { Pool } from 'pg';
import { knowledgeAccessErrorResponse } from '../access';
import type { KnowledgeRequestAuthenticator } from '../access';
import { withKnowledgeBase } from '../../../platform/database/resources/transaction';
import { KnowledgeNotificationError } from './errors';
import { countUnreadNotifications, listNotificationInbox, markAllNotificationsRead, markNotificationRead } from './service';

export interface KnowledgeNotificationRouteDependencies {
  /** Session/PAT authority; every route re-authenticates against live membership. */
  authenticator: KnowledgeRequestAuthenticator;
  pool: Pool;
  /** Trusted browser origins for the credential-bearing cross-origin responses. */
  trustedOrigins: readonly string[];
}

type Environment = { Variables: { knowledgeBaseId: string; userId: string } };

/**
 * N03 notification inbox over plain HTTP (session or PAT, knowledgeBase-scoped).
 *
 * The read model is the recipient's own mailbox: every route re-authenticates
 * against the live knowledgeBase membership and derives userId from that authority,
 * never from the URL or body, and responses carry the per-recipient visibility
 * filter of the service (§4.6/§5.3). Not wired into the runtime listener yet;
 * suggested wiring in the role that owns the listener (runtime/server.ts):
 *
 *   import { createKnowledgeNotificationRoutes } from '.';
 *   app.route('/', createKnowledgeNotificationRoutes({
 *     authenticator, pool,
 *     trustedOrigins: auth.options.trustedOrigins as string[],
 *   }));
 *
 * Endpoints (all JSON, credentials required, trusted-origin enforced):
 *   GET  /api/knowledge/:knowledgeBaseId/notifications            (?limit=&before=&beforeId=)
 *   GET  /api/knowledge/:knowledgeBaseId/notifications/unread-count
 *   POST /api/knowledge/:knowledgeBaseId/notifications/:notificationId/read
 *   POST /api/knowledge/:knowledgeBaseId/notifications/read-all
 *
 * The 'read' scope covers the mark-read writes deliberately: they mutate only
 * the recipient's own mailbox rows, never knowledgeBase content.
 */
export function createKnowledgeNotificationRoutes(dependencies: KnowledgeNotificationRouteDependencies): Hono<Environment> {
  const app = new Hono<Environment>();
  const origins = dependencies.trustedOrigins;

  app.use('/api/knowledge/:knowledgeBaseId/notifications*', async (context, next) => {
    context.header('Cache-Control', 'no-store');
    context.header('Referrer-Policy', 'no-referrer');
    if (!['GET', 'OPTIONS'].includes(context.req.method)
      && context.req.header('content-type')?.split(';')[0]?.trim() !== 'application/json') {
      return context.json({ code: 'INVALID_CONTENT_TYPE', message: 'JSON requests are required.' }, 415);
    }
    await next();
  });
  app.use('/api/knowledge/:knowledgeBaseId/notifications*', cors({
    origin: (origin) => (origins.includes(origin) ? origin : undefined),
    credentials: true,
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    maxAge: 600,
  }));
  app.use('/api/knowledge/:knowledgeBaseId/notifications*', bodyLimit({
    maxSize: 2 * 1_024,
    onError: (context) => context.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Notification request is too large.' }, 413),
  }));

  /** authenticate() owns origin trust (cookie CSRF), membership and scopes; userId never comes from the request. */
  app.use('/api/knowledge/:knowledgeBaseId/notifications*', async (context, next) => {
    try {
      const authority = await dependencies.authenticator.authenticate(context.req.raw, context.req.param('knowledgeBaseId'), ['read']);
      context.set('knowledgeBaseId', authority.knowledgeBaseId);
      context.set('userId', authority.userId);
    } catch (error) {
      return knowledgeAccessErrorResponse(error);
    }
    await next();
  });

  app.get('/api/knowledge/:knowledgeBaseId/notifications', async (context) => {
    const query = context.req.query();
    const result = await withKnowledgeBase(dependencies.pool, context.get('knowledgeBaseId'), (db) =>
      listNotificationInbox(db, {
        knowledgeBaseId: context.get('knowledgeBaseId'),
        userId: context.get('userId'),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.before === undefined ? {} : { before: query.before }),
        ...(query.beforeId === undefined ? {} : { beforeId: query.beforeId }),
      }));
    return context.json(result);
  });

  app.get('/api/knowledge/:knowledgeBaseId/notifications/unread-count', async (context) => {
    const unreadCount = await withKnowledgeBase(dependencies.pool, context.get('knowledgeBaseId'), (db) =>
      countUnreadNotifications(db, { knowledgeBaseId: context.get('knowledgeBaseId'), userId: context.get('userId') }));
    return context.json({ unreadCount });
  });

  app.post('/api/knowledge/:knowledgeBaseId/notifications/read-all', async (context) => {
    const updated = await withKnowledgeBase(dependencies.pool, context.get('knowledgeBaseId'), (db) =>
      markAllNotificationsRead(db, { knowledgeBaseId: context.get('knowledgeBaseId'), userId: context.get('userId') }));
    return context.json({ updated });
  });

  app.post('/api/knowledge/:knowledgeBaseId/notifications/:notificationId/read', async (context) => {
    const notification = await withKnowledgeBase(dependencies.pool, context.get('knowledgeBaseId'), (db) =>
      markNotificationRead(db, {
        knowledgeBaseId: context.get('knowledgeBaseId'),
        userId: context.get('userId'),
        notificationId: context.req.param('notificationId'),
      }));
    return context.json({ notification });
  });

  app.onError((error, context) => {
    if (error instanceof KnowledgeNotificationError) {
      return context.json({ code: error.code, message: error.code }, error.status as 400 | 404);
    }
    return knowledgeAccessErrorResponse(error);
  });
  return app;
}

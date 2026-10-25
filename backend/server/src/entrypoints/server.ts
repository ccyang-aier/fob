import { readFobOAuthOptions } from '../platform/identity/oauth-config';
import { createFobSocketTickets } from '../platform/identity/socket-tickets';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { Hono } from 'hono';
import { readFobServiceConfig } from '../platform/runtime/config';
import type { FobServiceConfig } from '../platform/runtime/config';
import { createFobAuth, createFobAuthRoutes, createSmtpAuthEmailTransport } from '../platform/identity';
import { createKnowledgeRequestAuthenticator } from '../modules/knowledge/access';
import { createVerificationEmailTransport } from '../platform/identity/email';
import { createKnowledgeOrganizationRoutes, createKnowledgeOrganizationService } from '../modules/knowledge/organization';
import { createKnowledgeCatalogRoutes, createKnowledgeCatalogService } from '../modules/knowledge/organization';
import { teamspacePermissionInvalidator } from '../modules/knowledge/permissions/fence';
import { createKnowledgeApiRoutes, createKnowledgePatRoutes } from '../modules/knowledge/api';
import { createKnowledgeAssetStorage } from '../modules/knowledge/assets/storage';
import { bindKnowledgeAssetStorage } from '../modules/knowledge/assets/runtime';
import { createKnowledgeCheckpointRoutes } from '../modules/knowledge/api/checkpoint-routes';
import { createDocumentCollaborationRoutes } from '../modules/knowledge/documents/http';
import { createKnowledgeDiscoveryRoutes } from '../modules/knowledge/discovery/http';
import { createKnowledgeNotificationRoutes } from '../modules/knowledge/notifications';
import { createKnowledgeTemplateRoutes } from '../modules/knowledge/templates';
import { createKnowledgeSubscriptionRoutes } from '../modules/knowledge/subscriptions';
import { bindKnowledgeStreamingTasks, createKnowledgeStreamingTasks } from '../modules/knowledge/ai';
import { createFobModelGateway } from '../platform/runtime/model-gateway';
import { subscribeFobKnowledgeEvents } from '../platform/runtime/knowledge-events';
import { createPageCollaborationListener } from '../modules/knowledge/collaboration/page-collaboration-bun';
import { revalidatePageConnections } from '../modules/knowledge/collaboration/page-collaboration-server';
import { createKnowledgeBaseEventRuntime } from '../modules/knowledge/collaboration/events';
import { pageCheckpointExtension } from '../modules/knowledge/collaboration/checkpoints';
import { createKnowledgeMcpAuthorizationRoutes } from '../modules/knowledge/mcp/oauth';
import { createKnowledgeMcpRequestHandler } from '../modules/knowledge/mcp/server';
import { handleKnowledgeMcpOnBun } from '../modules/knowledge/mcp/bun-adapter';
import { createDocumentPdfRenderer } from '../modules/knowledge/export/pdf';
import { createOfficePreviewRoutes } from '../modules/knowledge/export/office';
import { createDocumentPdfRoutes } from '../modules/knowledge/export/http';
import { startFobKnowledgeWorker } from './worker';
import { createModelCatalogRoutes } from '../modules/models/http';
import { createModelCatalogRepository } from '../modules/models/repository';
import { createRewardsRoutes, createRewardsService } from '../modules/rewards';

const mcpPathPattern = /^\/api\/knowledge\/[a-zA-Z0-9-]+\/mcp\/?$/;

export interface FobServiceRuntime {
  port: number;
  close(): Promise<void>;
}

/**
 * The single-process composition behind the shared HTTP listener (Z03): one
 * Bun socket hosts the auth routes, the organization API, the per-knowledgeBase
 * tRPC boundary, the MCP endpoint and the collaboration WebSocket upgrades.
 * Dedicated-role deployments reuse the same factories with narrower roles.
 */
export async function startFobService(config: FobServiceConfig, environment: NodeJS.ProcessEnv = process.env): Promise<FobServiceRuntime> {
  const pool = new Pool({ connectionString: config.databaseUrl, max: 8 });
  pool.on('error', () => {});
  const auth = createFobAuth({
    pool,
    config: config.auth,
    oauth: readFobOAuthOptions(environment),
    // Production reads SMTP from the environment; a development process
    // without SMTP prints each verification link to its own log.
    email: environment.SMTP_HOST
      ? createSmtpAuthEmailTransport(environment)
      : createVerificationEmailTransport('noreply@fob.dev', async (message: { to: string; subject: string; text: string }) => { console.log(`[auth] ${message.subject} → ${message.to}\n${message.text}`); }),
  });
  const authenticator = createKnowledgeRequestAuthenticator({ auth, pool });
  bindKnowledgeAssetStorage(config.roles.includes('api') && config.storage ? createKnowledgeAssetStorage(config.storage) : undefined);
  const externalOrigin = new URL(config.auth.baseUrl).origin;
  const events = createKnowledgeBaseEventRuntime({ authenticator });
  let activeCollaboration: ReturnType<typeof createPageCollaborationListener> | undefined;
  const revalidateConnections = async (knowledgeBaseId: string) => { if (activeCollaboration) await revalidatePageConnections(activeCollaboration.hocuspocus, { authenticator, pool }, knowledgeBaseId); };
  const eventRelay = config.redisUrl ? await subscribeFobKnowledgeEvents(config.redisUrl,
    ({ knowledgeBaseId, event }) => { events.hub.publish(knowledgeBaseId, event); if (event.type === 'acl.changed' || event.type === 'page.deleted') void revalidateConnections(knowledgeBaseId); }) : undefined;
  const checkpoints = config.roles.includes('collab') ? pageCheckpointExtension({ pool }) : undefined;
  const app = new Hono();
  app.route('/', createModelCatalogRoutes(createModelCatalogRepository(pool), auth.options.trustedOrigins as string[]));
  app.route('/', createOfficePreviewRoutes(auth.options.trustedOrigins as string[]));
  const documentPdf = createDocumentPdfRenderer();
  app.route('/', createDocumentPdfRoutes(auth.options.trustedOrigins as string[], html => documentPdf.render(html)));
  const socketTickets = createFobSocketTickets();
  app.route('/', createFobAuthRoutes(auth, (context) => context.env.clientAddress as string, socketTickets));
  app.route('/', createRewardsRoutes(auth, createRewardsService(pool)));
  app.route('/', createKnowledgeOrganizationRoutes(auth, createKnowledgeOrganizationService(pool)));
  app.route('/', createKnowledgeCatalogRoutes(auth, createKnowledgeCatalogService(pool, { permissions: teamspacePermissionInvalidator })));
  app.route('/', createKnowledgeApiRoutes({ auth, pool }));
  app.route('/', createKnowledgePatRoutes({ auth, pool }));
  app.route('/', createKnowledgeMcpAuthorizationRoutes({ auth, pool, externalOrigin }));
  app.route('/', createKnowledgeCheckpointRoutes({ auth, pool, checkpoints }));
  app.route('/', createDocumentCollaborationRoutes({ auth, pool, publicationSecret: config.auth.secret, onPermissionsChanged: revalidateConnections }));
  app.route('/', createKnowledgeDiscoveryRoutes({ authenticator, pool, trustedOrigins: auth.options.trustedOrigins as string[] }));
  app.route('/', createKnowledgeNotificationRoutes({ authenticator, pool, trustedOrigins: auth.options.trustedOrigins as string[] }));
  app.route('/', createKnowledgeTemplateRoutes({ authenticator, pool, trustedOrigins: auth.options.trustedOrigins as string[] }));
  app.route('/', createKnowledgeSubscriptionRoutes({ authenticator, pool, trustedOrigins: auth.options.trustedOrigins as string[] }));

  let mcp: ReturnType<typeof createKnowledgeMcpRequestHandler> | undefined;
  const listener = createPageCollaborationListener({ authenticator, pool }, {
    socketTickets,
    port: config.port,
    hostname: config.hostname,
    events: events.channel,
    ...(config.redisUrl ? { broadcast: { redisUrl: config.redisUrl } } : {}),
    ...(checkpoints ? { checkpoints } : {}),
    http: async (request, clientAddress) => {
      if (mcp && mcpPathPattern.test(new URL(request.url).pathname)) return handleKnowledgeMcpOnBun(mcp, request);
      return app.fetch(request, { clientAddress });
    },
  });
  activeCollaboration = listener;
  if (config.roles.includes('mcp')) mcp = createKnowledgeMcpRequestHandler({ authenticator, pool, hocuspocus: listener.hocuspocus, oauth: { externalOrigin } });
  // J04: bind the streaming AI task service to the tRPC registry. Without
  // model credentials the gateway holds no platform binding and aiTask.*
  // answers SERVICE_UNAVAILABLE by design.
  if (config.roles.includes('api')) {
    const gateway = createFobModelGateway(config);
    bindKnowledgeStreamingTasks(createKnowledgeStreamingTasks({
      pool,
      gateway,
      hocuspocus: config.roles.includes('collab') ? listener.hocuspocus : undefined,
    }));
  }
  const worker = config.roles.includes('worker') ? await startFobKnowledgeWorker(config) : undefined;
  console.log(`Fob service ready on http://${config.hostname}:${listener.port} (roles: ${config.roles.join(',')})`);
  return {
    port: listener.port as number,
    async close() {
      await worker?.close();
      await documentPdf.close();
      await eventRelay?.close();
      await listener.close();
      await pool.end();
    },
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => controller.abort());
  const runtime = await startFobService(readFobServiceConfig(process.env));
  controller.signal.addEventListener('abort', () => { void runtime.close(); });
}

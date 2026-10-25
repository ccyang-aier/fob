import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { entityIdSchema, linkPreviewInputSchema } from '@fob/shared/knowledge/contracts';
import type { KnowledgeRequestAuthenticator } from '../access';
import { knowledgeAccessErrorResponse } from '../access';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { loadPublicHtml } from './public-html';
import { parseLinkPreview } from './link-preview';

/** Public web metadata only. Local libraries need no account and expose no Fob resources. */
export function createRichContentRoutes(deps: { trustedOrigins: readonly string[]; authenticator: KnowledgeRequestAuthenticator; load?: typeof loadPublicHtml }) {
  const app = new Hono<{ Bindings: { clientAddress?: string } }>();
  const path = '/api/knowledge/:knowledgeBaseId/rich-content/link-preview';
  const requests = new Map<string, { count: number; until: number }>();
  let active = 0;
  app.use(path, cors({ origin: origin => deps.trustedOrigins.includes(origin) ? origin : undefined, credentials: true, allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
  app.use(path, bodyLimit({ maxSize: 8192 }));
  app.post(path, async context => {
    context.header('Cache-Control', 'no-store');
    context.header('X-Content-Type-Options', 'nosniff');
    if (!hasTrustedFobOrigin(context.req.raw, deps.trustedOrigins)) return context.json({ code: 'INVALID_ORIGIN' }, 403);
    if (context.req.header('content-type')?.split(';')[0] !== 'application/json') return context.json({ code: 'INVALID_CONTENT_TYPE' }, 415);
    const knowledgeBaseId = entityIdSchema.safeParse(context.req.param('knowledgeBaseId'));
    const input = linkPreviewInputSchema.safeParse(await context.req.json().catch(() => null));
    if (!knowledgeBaseId.success || !input.success) return context.json({ code: 'INVALID_INPUT' }, 400);
    if (input.data.source === 'server') {
      try { const authority = await deps.authenticator.authenticate(context.req.raw, knowledgeBaseId.data); await deps.authenticator.refresh(authority, ['read']); }
      catch (cause) { return knowledgeAccessErrorResponse(cause); }
    }
    const key = context.env?.clientAddress ?? 'local', now = Date.now();
    for (const [address, item] of requests) if (item.until <= now) requests.delete(address);
    const budget = requests.get(key) ?? { count: 0, until: now + 60_000 };
    if (budget.count >= 30 || active >= 4 || requests.size >= 2000 && !requests.has(key)) {
      context.header('Retry-After', '60'); return context.json({ code: 'PREVIEW_RATE_LIMITED' }, 429);
    }
    budget.count++; requests.set(key, budget); active++;
    try {
      const signal = AbortSignal.any([context.req.raw.signal, AbortSignal.timeout(8000)]);
      const result = await (deps.load ?? loadPublicHtml)(input.data.url, signal);
      return context.json(parseLinkPreview(result.html, result.url));
    } catch { return context.json({ code: 'PREVIEW_UNAVAILABLE' }, 422); }
    finally { active--; }
  });
  return app;
}

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { hasTrustedFobOrigin } from '../../../platform/identity/config';
import { DocumentPdfError } from './pdf';

const path = '/api/knowledge/export/pdf';

/** Converts caller-supplied bytes only; guest documents need no knowledgeBase lookup or account. */
export function createDocumentPdfRoutes(trustedOrigins: readonly string[], render: (html: string) => Promise<Uint8Array>) {
  const app = new Hono();
  app.use(path, cors({ origin: origin => trustedOrigins.includes(origin) ? origin : undefined,
    allowMethods: ['POST', 'OPTIONS'], allowHeaders: ['Content-Type'], maxAge: 600 }));
  app.use(path, async (context, next) => {
    context.header('Cache-Control', 'no-store');
    if (!hasTrustedFobOrigin(context.req.raw, trustedOrigins)) return context.json({ code: 'INVALID_ORIGIN' }, 403);
    if (context.req.method === 'POST' && context.req.header('content-type')?.split(';')[0]?.trim() !== 'text/html') return context.json({ code: 'INVALID_CONTENT_TYPE' }, 415);
    await next();
  });
  // Includes data URLs for images and selected font subsets, without retaining a second copy.
  app.use(path, bodyLimit({ maxSize: 64 * 1024 * 1024, onError: context => context.json({ code: 'PAYLOAD_TOO_LARGE' }, 413) }));
  app.post(path, async context => {
    const html = await context.req.text();
    if (!html.trim()) return context.json({ code: 'INVALID_SNAPSHOT' }, 400);
    try {
      const bytes = await render(html);
      return new Response(bytes as Uint8Array<ArrayBuffer>, { headers: {
        'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="document.pdf"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Access-Control-Allow-Origin': context.req.header('origin')!,
      } });
    } catch (error) {
      const code = error instanceof DocumentPdfError ? error.code : 'PDF_RENDER_FAILED';
      return context.json({ code }, code === 'PDF_BUSY' ? 429 : code === 'PDF_UNAVAILABLE' ? 503 : 422);
    }
  });
  return app;
}

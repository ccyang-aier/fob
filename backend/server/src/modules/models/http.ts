import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ModelCatalogRepository } from './repository';

/** Reference metadata only; the catalog never authorizes model execution. */
export function createModelCatalogRoutes(repository: ModelCatalogRepository, trustedOrigins: string[]) {
  const app = new Hono();
  app.use('/api/models', cors({
    origin: (origin) => trustedOrigins.includes(origin) ? origin : undefined,
    allowMethods: ['GET'],
    maxAge: 600,
  }));
  app.get('/api/models', async (context) => {
    const catalog = await repository.list();
    context.header('Cache-Control', 'public, max-age=300');
    return context.json(catalog);
  });
  app.onError((_error, context) => {
    context.header('Cache-Control', 'no-store');
    context.header('Retry-After', '30');
    return context.json({ code: 'MODEL_CATALOG_UNAVAILABLE', message: 'Model reference data is temporarily unavailable.', retryable: true }, 503);
  });
  return app;
}

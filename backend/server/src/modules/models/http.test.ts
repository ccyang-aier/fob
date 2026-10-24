import { describe, expect, test } from 'bun:test';
import { createModelCatalogRoutes } from './http';
import { readBundledModelCatalog } from './admin';

describe('public model reference API', () => {
  test('serves schema-validated metadata without identity and caches only successful responses', async () => {
    const catalog = await readBundledModelCatalog();
    const app = createModelCatalogRoutes({ list: async () => catalog }, ['http://localhost:3000']);
    const response = await app.request('/api/models', { headers: { Origin: 'http://localhost:3000' } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(catalog);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=300');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:3000');
    expect(response.headers.has('Access-Control-Allow-Credentials')).toBe(false);
    const untrusted = await app.request('/api/models', { headers: { Origin: 'https://untrusted.example' } });
    expect(untrusted.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });

  test('does not expose a write surface and allows only GET in browser preflight', async () => {
    const app = createModelCatalogRoutes({ list: async () => ({ items: [] }) }, ['http://localhost:3000']);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await app.request('/api/models', { method, body: '{}' });
      expect(response.status).toBe(404);
    }
    const preflight = await app.request('/api/models', { method: 'OPTIONS', headers: {
      Origin: 'http://localhost:3000', 'Access-Control-Request-Method': 'POST',
    } });
    expect(preflight.headers.get('Access-Control-Allow-Methods')).toBe('GET');
  });

  test('database or invalid persisted data failures return a retryable 503 without diagnostic leakage', async () => {
    const secret = 'private-database-detail';
    const app = createModelCatalogRoutes({ list: async () => { throw new Error(secret); } }, []);
    const response = await app.request('/api/models');
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('30');
    expect(await response.json()).toEqual({ code: 'MODEL_CATALOG_UNAVAILABLE', message: 'Model reference data is temporarily unavailable.', retryable: true });
  });
});

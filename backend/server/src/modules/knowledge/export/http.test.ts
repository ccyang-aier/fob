import { describe, expect, test } from 'bun:test';
import { createDocumentPdfRoutes } from './http';
import { DocumentPdfError } from './pdf';

const origin = 'http://localhost:3000';
const path = '/api/knowledge/export/pdf';
const request = (body = '<html>内容</html>', headers: Record<string, string> = {}) => new Request(`http://localhost:8711${path}`, {
  method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/html;charset=utf-8', ...headers }, body,
});

describe('stateless PDF boundary', () => {
  test('returns an actual PDF to guests without querying or persisting knowledgeBase content', async () => {
    let input = '';
    const app = createDocumentPdfRoutes([origin], async html => { input = html; return new TextEncoder().encode('%PDF-1.7'); });
    const response = await app.fetch(request());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('access-control-allow-origin')).toBe(origin);
    expect(await response.text()).toBe('%PDF-1.7');
    expect(input).toContain('内容');
  });
  test('rejects untrusted origins, missing origins, non-HTML and empty payloads before rendering', async () => {
    let calls = 0;
    const app = createDocumentPdfRoutes([origin], async () => { calls++; return new Uint8Array(); });
    for (const [headers, status] of [[{ Origin: 'https://untrusted.test' }, 403], [{ Origin: '' }, 403], [{ 'Content-Type': 'application/json' }, 415]] as const) {
      expect((await app.fetch(request('body', headers))).status).toBe(status);
    }
    expect((await app.fetch(request(' '))).status).toBe(400);
    expect(calls).toBe(0);
  });
  test('maps capacity and renderer availability to actionable errors', async () => {
    for (const [code, status] of [['PDF_BUSY', 429], ['PDF_UNAVAILABLE', 503], ['PDF_RENDER_FAILED', 422]] as const) {
      const app = createDocumentPdfRoutes([origin], async () => { throw new DocumentPdfError(code); });
      const response = await app.fetch(request());
      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ code });
    }
  });
  test('rejects oversized resource snapshots before allocating renderer capacity', async () => {
    let called = false;
    const app = createDocumentPdfRoutes([origin], async () => { called = true; return new Uint8Array(); });
    const response = await app.fetch(request('large snapshot', { 'Content-Length': String(64 * 1024 * 1024 + 1) }));
    expect(response.status).toBe(413);
    expect(called).toBe(false);
  });
});

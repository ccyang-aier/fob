import { describe, expect, test } from 'bun:test';
import { KnowledgeAccessError } from '../access';
import type { KnowledgeRequestAuthenticator } from '../access';
import { createRichContentRoutes } from './http';
import { parseLinkPreview } from './link-preview';
import { isPublicContentAddress, loadPublicHtml, publicContentUrl } from './public-html';

const library = '10000000-0000-4000-8000-000000000001', origin = 'https://fob.example';
const denied = { authenticate: async () => { throw new KnowledgeAccessError('UNAUTHENTICATED'); } } as unknown as KnowledgeRequestAuthenticator;

describe('external public link metadata', () => {
  test('extracts bounded public metadata without following page code', () => {
    const preview = parseLinkPreview('<title>Fallback</title><meta property="og:title" content="Article"><meta name="description" content="A useful article"><meta property="og:image" content="/cover.png"><script>throw new Error()</script>', 'https://example.com/post');
    expect(preview).toEqual({ url: 'https://example.com/post', title: 'Article', description: 'A useful article', image: 'https://example.com/cover.png', siteName: 'example.com' });
    expect(parseLinkPreview('<title>No cover</title>', 'https://example.com/').image).toBe('');
    expect(parseLinkPreview('<meta property="og:image" content="http://127.0.0.1/secret">', 'https://example.com/').image).toBe('');
  });
  test('rejects private, mapped, metadata-service, credential and unusual-port targets', async () => {
    for (const address of ['127.0.0.1', '169.254.169.254', '10.1.1.1', '::1', '::ffff:127.0.0.1', 'fd00::1', '192.168.1.1']) expect(isPublicContentAddress(address)).toBe(false);
    expect(isPublicContentAddress('1.1.1.1')).toBe(true);
    for (const url of ['http://localhost/', 'http://2130706433/', 'http://127.1/', 'https://example.com:9000/', 'https://u:p@example.com/', 'https://a.internal/']) expect(() => publicContentUrl(url)).toThrow();
    await expect(loadPublicHtml('https://example.com', AbortSignal.timeout(1000), async () => [{ address: '127.0.0.1', family: 4 }])).rejects.toThrow('INVALID_PUBLIC_ADDRESS');
    await expect(loadPublicHtml('https://example.com', AbortSignal.timeout(1000), async () => [{ address: '1.1.1.1', family: 4 }, { address: '10.0.0.1', family: 4 }])).rejects.toThrow('INVALID_PUBLIC_ADDRESS');
  });
  test('local libraries can fetch public metadata; server scope and origin remain enforced', async () => {
    let fetched = 0;
    const app = createRichContentRoutes({ trustedOrigins: [origin], authenticator: denied, load: async url => { fetched++; return { url, html: '<title>Public page</title>' }; } });
    const request = (source: string, requestOrigin = origin) => app.request(`/api/knowledge/${library}/rich-content/link-preview`, { method: 'POST', headers: { origin: requestOrigin, 'content-type': 'application/json' }, body: JSON.stringify({ source, url: 'https://example.com' }) });
    const response = await request('local');
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ title: 'Public page' });
    expect((await request('server')).status).toBe(401);
    expect((await request('local', 'https://attacker.example')).status).toBe(403);
    expect(fetched).toBe(1);
  });
});

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createOAuthHttp, isPublicOAuthAddress } from './oauth-http';

let origin: string;
let forbiddenHits = 0;
const server = createServer(async (request, response) => {
  if (request.url === '/redirect') { response.writeHead(307, { location: `${origin}/forbidden` }); response.end(); return; }
  if (request.url === '/forbidden') forbiddenHits++;
  if (request.url === '/slow') { await new Promise<void>((resolve) => setTimeout(resolve, 400)); if (response.destroyed) return; }
  response.writeHead(200, { 'content-type': request.url === '/jwks' ? 'application/jwk-set+json' : 'application/json' });
  response.end(JSON.stringify({ host: request.headers.host, value: request.url === '/large' ? 'private-provider-data'.repeat(10_000) : 'ok' }));
});
beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }); });

describe('bounded OAuth server-to-server network transport', () => {
  test('rejects private, mapped, metadata, multicast, documentation and transition addresses by default', () => {
    for (const address of ['127.0.0.1', '10.0.0.1', '100.64.1.2', '169.254.169.254', '172.16.1.2', '192.168.1.2', '192.0.2.1', '198.18.0.1', '224.0.0.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2001:db8::1', '2002:7f00:1::']) expect(isPublicOAuthAddress(address)).toBe(false);
    for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) expect(isPublicOAuthAddress(address)).toBe(true);
  });
  test('pins the one checked DNS answer for the socket and preserves the configured Host', async () => {
    const local = origin.replace('127.0.0.1', 'localhost');
    let resolutions = 0;
    const http = createOAuthHttp({ origins: [local], production: false, allowPrivateNetwork: false, timeoutMs: 1_000 }, async () => {
      resolutions++; return [{ address: resolutions === 1 ? '127.0.0.1' : '127.0.0.2', family: 4 }];
    });
    expect(await (await http(`${local}/ok`)).json()).toMatchObject({ host: new URL(local).host, value: 'ok' });
    expect(resolutions).toBe(1);
  });
  test('rejects DNS rebinding to private IPs, including mixed public/private answers, before connecting', async () => {
    for (const addresses of [[{ address: '127.0.0.1', family: 4 }], [{ address: '8.8.8.8', family: 4 }, { address: '169.254.169.254', family: 4 }]]) {
      const http = createOAuthHttp({ origins: ['https://idp.example.test'], production: true, allowPrivateNetwork: false, timeoutMs: 100 }, async () => addresses);
      await expect(http('https://idp.example.test/token')).rejects.toThrow('OAuth provider is unavailable');
    }
    const misleadingLoopback = createOAuthHttp({ origins: ['http://localhost:1234'], production: false, allowPrivateNetwork: false, timeoutMs: 100 }, async () => [{ address: '169.254.169.254', family: 4 }]);
    await expect(misleadingLoopback('http://localhost:1234/token')).rejects.toThrow('OAuth provider is unavailable');
  });
  test('checks exact URL origin and forbids credentials/query/redirect before credentials can leave', async () => {
    const http = createOAuthHttp({ origins: [origin], production: false, allowPrivateNetwork: false, timeoutMs: 200 });
    for (const url of [`${origin}/token?secret=private`, `${origin}/token#private`, 'http://169.254.169.254', 'file:///private', origin.replace('127.0.0.1', 'user:secret@127.0.0.1')]) {
      await expect(http(url)).rejects.toThrow('OAuth provider is unavailable');
    }
    await expect(http(`${origin}/redirect`, { method: 'POST', body: new URLSearchParams({ client_secret: 'private' }) })).rejects.toThrow('OAuth provider is unavailable');
    expect(forbiddenHits).toBe(0);
  });
  test('bounds response bytes, request duration, stalled DNS and caller cancellation with sanitized errors', async () => {
    const options = { origins: [origin], production: false, allowPrivateNetwork: false, timeoutMs: 100 };
    const http = createOAuthHttp(options);
    await expect(http(`${origin}/large`)).rejects.toThrow('OAuth provider is unavailable');
    const started = Date.now();
    await expect(http(`${origin}/slow`)).rejects.toThrow('OAuth provider is unavailable');
    expect(Date.now() - started).toBeLessThan(1_000);
    await expect(http(`${origin}/ok`, { signal: AbortSignal.abort() })).rejects.toThrow('OAuth provider is unavailable');
    const stalledDns = createOAuthHttp({ ...options, origins: ['https://idp.example.test'] }, () => new Promise(() => {}));
    await expect(stalledDns('https://idp.example.test')).rejects.toThrow('OAuth provider is unavailable');
    expect((await http(`${origin}/jwks`)).status).toBe(200);
  });
});

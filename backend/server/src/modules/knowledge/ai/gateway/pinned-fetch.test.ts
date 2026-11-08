import { afterAll, beforeAll, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createPinnedProviderFetch } from './pinned-fetch';
import { isPublicProviderAddress, normalizeConnectionEndpoint, resolveProviderEndpoint } from './endpoint-policy';

let origin: string, requests: { path: string; host?: string; authorization?: string }[] = [];
const server = createServer((request, response) => {
  requests.push({ path: request.url!, host: request.headers.host, authorization: request.headers.authorization });
  if (request.url === '/v1/redirect') { response.writeHead(302, { location: `${origin}/stolen` }); response.end(); }
  else if (request.url === '/v1/oversized') { response.writeHead(200, { 'content-length': '999999999' }); response.end(); }
  else if (request.url === '/v1/invalid-status') { response.writeHead(600); response.end('malformed response'); }
  else if (request.url === '/v1/wait') { request.on('close', () => response.destroy()); }
  else { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ path: request.url, host: request.headers.host })); }
});
beforeAll(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://fob-approved.test:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });

test('IP policy rejects private, metadata, documentation, transition and mapped forms', () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '127.0.0.1', '169.254.169.254', '172.31.1.1', '192.168.1.1', '100.64.0.1', '198.18.0.1', '203.0.113.1', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2001:db8::1', '2002:7f00:1::1']) expect(isPublicProviderAddress(ip), ip).toBe(false);
  for (const ip of ['1.1.1.1', '8.8.8.8', '104.16.0.1', '2001:4860:4860::8888', '2606:4700:4700::1111']) expect(isPublicProviderAddress(ip), ip).toBe(true);
  for (const url of ['http://public.example/v1', 'https://127.1/v1', 'https://0x7f000001/v1', 'https://[::ffff:127.0.0.1]/v1', 'https://metadata.google.internal/v1', 'https://user:pass@api.example/v1', 'https://api.example/v1?target=x']) expect(() => normalizeConnectionEndpoint(url)).toThrow('endpoint_denied');
});

test('mixed public/private DNS is denied; every operation resolves and validates again', async () => {
  const controller = new AbortController();
  await expect(resolveProviderEndpoint('https://api.example/v1', { lookup: async () => [{ address: '1.1.1.1', family: 4 }, { address: '127.0.0.1', family: 4 }] }, controller.signal)).rejects.toThrow('endpoint_denied');
  let calls = 0;
  const policy = { lookup: async () => [{ address: ++calls === 1 ? '1.1.1.1' : '127.0.0.1', family: 4 }] };
  expect((await resolveProviderEndpoint('https://api.example/v1', policy, controller.signal)).address.address).toBe('1.1.1.1');
  await expect(resolveProviderEndpoint('https://api.example/v1', policy, controller.signal)).rejects.toThrow('endpoint_denied');
  expect(calls).toBe(2);
});

test('Node/Bun transport pins lookup while retaining the original HTTP host and credentials', async () => {
  let resolutions = 0;
  const fetch = createPinnedProviderFetch(`${origin}/v1`, { approvedLocalEndpoints: [`${origin}/v1`], lookup: async () => { resolutions++; return [{ address: '127.0.0.1', family: 4 }]; } });
  const response = await fetch(`${origin}/v1/models`, { headers: { authorization: 'Bearer synthetic-test-key' } });
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ path: '/v1/models', host: new URL(origin).host });
  expect(resolutions).toBe(1); expect(requests.at(-1)?.authorization).toBe('Bearer synthetic-test-key');
  await expect(fetch(`${origin}/elsewhere`)).rejects.toThrow('endpoint_denied');
});

test('redirects never forward a key and declared oversized responses are rejected', async () => {
  const fetch = createPinnedProviderFetch(`${origin}/v1`, { approvedLocalEndpoints: [`${origin}/v1`], lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
  const prior = requests.length;
  await expect(fetch(`${origin}/v1/redirect`, { headers: { authorization: 'Bearer synthetic-test-key' } })).rejects.toThrow('endpoint_denied');
  expect(requests.slice(prior).map(item => item.path)).toEqual(['/v1/redirect']);
  await expect(fetch(`${origin}/v1/oversized`)).rejects.toThrow('response_too_large');
  await expect(fetch(`${origin}/v1/invalid-status`)).rejects.toThrow('invalid_response');
});

test('cancellation closes an outstanding pinned socket', async () => {
  const fetch = createPinnedProviderFetch(`${origin}/v1`, { approvedLocalEndpoints: [`${origin}/v1`], lookup: async () => [{ address: '127.0.0.1', family: 4 }] });
  const controller = new AbortController();
  const pending = fetch(`${origin}/v1/wait`, { signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  await expect(pending).rejects.toThrow();
});

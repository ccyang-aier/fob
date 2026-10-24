import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { checkedOAuthUrl, isLoopbackHost } from './oauth-config';

const privateAddresses = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) privateAddresses.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2002::', 16]] as const) privateAddresses.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicOAuthAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !privateAddresses.check(address, 'ipv4')
    : family === 6 && globalV6.check(address, 'ipv6') && !privateAddresses.check(address, 'ipv6');
}

export class OAuthProviderUnavailable extends Error {
  constructor() { super('OAuth provider is unavailable. Start a new sign-in attempt.'); this.name = 'OAuthProviderUnavailable'; }
}

type Address = { address: string; family: number };
type ResolveAddresses = (hostname: string) => Promise<Address[]>;

/** Exact server-owned origins, one vetted DNS resolution per request, no redirects or raw errors. */
export function createOAuthHttp(options: {
  origins: readonly string[]; production: boolean; allowPrivateNetwork: boolean; timeoutMs: number;
}, resolve: ResolveAddresses = (hostname) => lookup(hostname, { all: true, verbatim: true })) {
  const allowedOrigins = new Set(options.origins);
  return async (input: string | URL, init: { method?: 'GET' | 'POST'; headers?: ConstructorParameters<typeof Headers>[0]; body?: URLSearchParams; signal?: AbortSignal } = {}): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const forwardAbort = () => controller.abort();
    init.signal?.addEventListener('abort', forwardAbort, { once: true });
    if (init.signal?.aborted) controller.abort();
    let abortDns: (() => void) | undefined;
    try {
      const url = checkedOAuthUrl(String(input), options.production);
      if (!allowedOrigins.has(url.origin) || controller.signal.aborted) throw new OAuthProviderUnavailable();
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const addresses = await Promise.race([
        isIP(hostname) ? Promise.resolve([{ address: hostname, family: isIP(hostname) }]) : resolve(hostname),
        new Promise<never>((_, reject) => {
          abortDns = () => reject(new OAuthProviderUnavailable());
          controller.signal.addEventListener('abort', abortDns, { once: true });
        }),
      ]);
      if (abortDns) controller.signal.removeEventListener('abort', abortDns);
      const developmentLoopback = !options.production && isLoopbackHost(hostname);
      const privateAllowed = options.allowPrivateNetwork || developmentLoopback;
      if (!addresses.length || addresses.some((item) => !isIP(item.address) || isIP(item.address) !== item.family
        || (developmentLoopback && !isLoopbackHost(item.address))
        || (!privateAllowed && !isPublicOAuthAddress(item.address)))) throw new OAuthProviderUnavailable();
      const pinned = addresses[0]!;
      return await new Promise<Response>((resolveResponse, reject) => {
        const headers = Object.fromEntries(new Headers(init.headers));
        const body = init.body?.toString();
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
          method: init.method ?? 'GET', headers, signal: controller.signal,
          // Prevent a second DNS lookup (including rebinding) between checking and connecting.
          family: pinned.family,
          lookup: (_hostname, _lookupOptions, callback) => callback(null, pinned.address, pinned.family),
          agent: false, maxHeaderSize: 16 * 1_024,
        }, (response) => {
          const chunks: Buffer[] = [];
          let length = 0;
          const status = response.statusCode ?? 0;
          if (status !== 200 || !/^application\/(?:json|[a-z-]+\+json)$/i.test(response.headers['content-type']?.split(';')[0]?.trim() ?? '')) {
            response.destroy(); request.destroy(); reject(new OAuthProviderUnavailable()); return;
          }
          response.on('data', (chunk: Buffer) => {
            length += chunk.length;
            if (length > 128 * 1_024) { response.destroy(); request.destroy(); reject(new OAuthProviderUnavailable()); }
            else chunks.push(chunk);
          });
          response.once('error', () => reject(new OAuthProviderUnavailable()));
          response.once('end', () => resolveResponse(new Response(Buffer.concat(chunks), { status, headers: { 'Content-Type': 'application/json' } })));
        });
        request.once('error', () => reject(new OAuthProviderUnavailable()));
        request.end(body);
      });
    } catch { throw new OAuthProviderUnavailable(); }
    finally {
      clearTimeout(timer);
      if (abortDns) controller.signal.removeEventListener('abort', abortDns);
      init.signal?.removeEventListener('abort', forwardAbort);
    }
  };
}

export type OAuthHttp = ReturnType<typeof createOAuthHttp>;

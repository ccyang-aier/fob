import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { TextDecoder } from 'node:util';
import { richContentUrl } from '@fob/shared/knowledge/rich-content';

const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [['2001:db8::', 32], ['2001::', 32], ['2002::', 16]] as const) blocked.addSubnet(address, prefix, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

export function isPublicContentAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4 ? !blocked.check(address, 'ipv4') : family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function publicContentUrl(value: string): URL {
  const safe = richContentUrl(value);
  if (!safe) throw new Error('INVALID_PUBLIC_URL');
  const url = new URL(safe), hostname = url.hostname.replace(/^\[|\]$/g, '');
  if ((url.port && !['80', '443'].includes(url.port)) || !hostname.includes('.') && !isIP(hostname)
    || hostname === 'localhost' || /\.(?:localhost|local|internal|test|invalid)$/.test(hostname)
    || isIP(hostname) && !isPublicContentAddress(hostname)) throw new Error('INVALID_PUBLIC_URL');
  url.hash = '';
  return url;
}

type Resolver = (hostname: string) => Promise<{ address: string; family: number }[]>;
/** Resolve and pin every hop; no cookies, proxy inheritance, compression, scripts or subresources. */
export async function loadPublicHtml(value: string, signal: AbortSignal, resolve: Resolver = host => lookup(host, { all: true, verbatim: true })): Promise<{ url: string; html: string }> {
  let current = publicContentUrl(value);
  for (let redirect = 0; redirect <= 3; redirect++) {
    signal.throwIfAborted();
    const host = current.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await new Promise<{ address: string; family: number }[]>((resolveDns, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      resolve(host).then(resolveDns, reject).finally(() => signal.removeEventListener('abort', abort));
    });
    signal.throwIfAborted();
    if (!addresses.length || addresses.some(item => isIP(item.address) !== item.family || !isPublicContentAddress(item.address))) throw new Error('INVALID_PUBLIC_ADDRESS');
    const pinned = addresses[0]!;
    const result = await new Promise<{ location?: string; html?: string }>((resolveResponse, reject) => {
      const request = (current.protocol === 'https:' ? httpsRequest : httpRequest)(current, {
        method: 'GET', signal, agent: false, family: pinned.family, maxHeaderSize: 16 * 1024,
        lookup: (_hostname, _options, callback) => callback(null, pinned.address, pinned.family),
        headers: { 'User-Agent': 'Fob-LinkPreview/1.0', Accept: 'text/html,application/xhtml+xml', 'Accept-Encoding': 'identity' },
      }, response => {
        const status = response.statusCode ?? 0;
        if ([301, 302, 303, 307, 308].includes(status)) {
          const location = response.headers.location;
          response.destroy();
          if (!location) reject(new Error('INVALID_REDIRECT')); else resolveResponse({ location });
          return;
        }
        if (status !== 200 || !/^text\/html\b|^application\/xhtml\+xml\b/i.test(response.headers['content-type'] || '')
          || response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') {
          response.destroy(); reject(new Error('PREVIEW_UNAVAILABLE')); return;
        }
        const chunks: Buffer[] = []; let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > 512 * 1024) { response.destroy(); request.destroy(); reject(new Error('PREVIEW_TOO_LARGE')); }
          else chunks.push(chunk);
        });
        response.once('error', reject);
        response.once('end', () => {
          const bytes = Buffer.concat(chunks);
          const encoding = response.headers['content-type']?.match(/charset\s*=\s*["']?([\w-]+)/i)?.[1]
            ?? bytes.subarray(0, 2048).toString().match(/charset\s*=\s*["']?([\w-]+)/i)?.[1] ?? 'utf-8';
          try { resolveResponse({ html: new TextDecoder(encoding).decode(bytes) }); }
          catch { resolveResponse({ html: bytes.toString('utf8') }); }
        });
      });
      request.once('error', reject);
      request.end();
    });
    if (result.location) { current = publicContentUrl(new URL(result.location, current).href); continue; }
    return { url: current.href, html: result.html ?? '' };
  }
  throw new Error('TOO_MANY_REDIRECTS');
}

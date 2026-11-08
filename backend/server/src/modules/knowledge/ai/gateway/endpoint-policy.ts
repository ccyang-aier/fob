import { lookup as lookupDns } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ModelGatewayError } from './errors';
import { abortable } from '../abort';

export type ProviderAddress = { address: string; family: number };
export type ProviderLookup = (hostname: string) => Promise<readonly ProviderAddress[]>;
export interface EndpointPolicy { approvedLocalEndpoints?: readonly string[]; lookup?: ProviderLookup; allowedQueryParameters?: readonly string[] }

const deny = () => new ModelGatewayError('endpoint_denied');
const canonical = (value: string) => {
  const url = new URL(value);
  if (url.hostname.endsWith('.')) url.hostname = url.hostname.slice(0, -1);
  return url.href.replace(/\/+$/, '');
};

/** Conservative globally-routable IP policy, including IPv6 transition ranges. */
export function isPublicProviderAddress(value: string): boolean {
  const ip = value.replace(/^\[|\]$/g, '').toLowerCase();
  if (isIP(ip) === 4) {
    const [a, b, c] = ip.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a! >= 224 || a === 169 && b === 254 || a === 172 && b! >= 16 && b! <= 31 || a === 192 && (b === 168 || b === 0 && (c === 0 || c === 2) || b === 88 && c === 99) || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113 || a === 100 && b! >= 64 && b! <= 127);
  }
  if (isIP(ip) !== 6 || ip.includes('%') || ip.includes('.')) return false;
  const first = Number.parseInt(ip.split(':')[0]!, 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return false;
  // Reject documentation, protocol-assignment, Teredo, 6to4 and reserved space.
  const second = Number.parseInt(ip.split(':')[1] || '0', 16);
  return !(first === 0x2001 && (second < 0x0200 || second === 0x0db8) || first === 0x2002 || first === 0x3fff && second < 0x1000);
}

/** Syntax policy is checked at save and again at use; DNS is never trusted once. */
export function normalizeConnectionEndpoint(value: string, policy: EndpointPolicy = {}): string {
  try {
    const url = new URL(value);
    if (value.length > 2048 || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw deny();
    const normalized = canonical(value);
    if (policy.approvedLocalEndpoints?.some(endpoint => canonical(endpoint) === normalized)) return normalized;
    if (url.protocol !== 'https:') throw deny();
    const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
    if (!host || !host.includes('.') && !isIP(host) || /(^|\.)(localhost|local|internal|lan|home|test|invalid)$/.test(host)) throw deny();
    if (isIP(host) && !isPublicProviderAddress(host)) throw deny();
    return normalized;
  } catch { throw deny(); }
}

export async function resolveProviderEndpoint(value: string, policy: EndpointPolicy, signal: AbortSignal): Promise<{ url: URL; address: ProviderAddress }> {
  const normalized = normalizeConnectionEndpoint(value, policy), url = new URL(normalized);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const permittedLocal = policy.approvedLocalEndpoints?.some(endpoint => canonical(endpoint) === normalized) ?? false;
  const lookup: ProviderLookup = policy.lookup ?? (hostname => lookupDns(hostname, { all: true, verbatim: true }));
  const timeout = AbortSignal.timeout(8_000), combined = AbortSignal.any([signal, timeout]);
  try {
    const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await abortable(lookup(host), combined);
    signal.throwIfAborted();
    if (!addresses.length || addresses.length > 32 || addresses.some(item => ![4, 6].includes(item.family) || isIP(item.address) !== item.family || !permittedLocal && !isPublicProviderAddress(item.address))) throw deny();
    return { url, address: addresses[0]! };
  } catch (error) {
    if (signal.aborted) throw signal.reason;
    if (error instanceof ModelGatewayError) throw error;
    throw deny();
  }
}

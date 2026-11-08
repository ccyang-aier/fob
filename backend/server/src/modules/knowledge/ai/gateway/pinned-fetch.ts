import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import type { LookupFunction } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { ModelGatewayError } from './errors';
import { normalizeConnectionEndpoint, resolveProviderEndpoint } from './endpoint-policy';
import type { EndpointPolicy } from './endpoint-policy';
import type { GatewayFetch } from './types';

/**
 * A new socket uses exactly a just-validated address. The HTTP Host and TLS SNI
 * remain the original hostname; no proxy/env dispatcher or redirect can resolve
 * a second destination after the DNS check. Works through Node http(s) in Bun.
 */
export function createPinnedProviderFetch(baseUrl: string, policy: EndpointPolicy = {}): GatewayFetch {
  const base = normalizeConnectionEndpoint(baseUrl, policy);
  return async (input, init) => {
    const original = input instanceof Request ? input : undefined;
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    if (!target.href.startsWith(`${base}/`) || [...target.searchParams.keys()].some(key => !policy.allowedQueryParameters?.includes(key)) || target.hash || target.username || target.password) throw new ModelGatewayError('endpoint_denied');
    const signal = init?.signal ?? original?.signal ?? AbortSignal.timeout(90_000);
    signal.throwIfAborted();
    const resolved = await resolveProviderEndpoint(base, policy, signal);
    const headers = new Headers(original?.headers);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    headers.set('accept-encoding', 'identity');
    headers.delete('host'); headers.delete('connection'); headers.delete('content-length');
    let body: Uint8Array | string | undefined;
    const raw = init?.body;
    if (typeof raw === 'string' || raw instanceof Uint8Array) body = raw;
    else if (raw instanceof ArrayBuffer) body = new Uint8Array(raw);
    else if (raw != null) throw new ModelGatewayError('invalid_request');
    else if (original?.body) body = new Uint8Array(await original.arrayBuffer());
    if (body && Buffer.byteLength(body) > 2 * 1024 * 1024) throw new ModelGatewayError('response_too_large');
    if (body !== undefined) headers.set('content-length', String(Buffer.byteLength(body)));
    const method = init?.method ?? original?.method ?? 'GET';
    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const fail = (error: unknown) => { if (!settled) { settled = true; reject(signal.aborted ? signal.reason : error instanceof ModelGatewayError ? error : new ModelGatewayError('provider_unavailable', true)); } };
      // family + no auto-selection ensure one pinned lookup result per socket.
      const lookup = ((_host, _options, callback) => callback(null, resolved.address.address, resolved.address.family)) as LookupFunction;
      const options: RequestOptions & { autoSelectFamily: boolean } = { method, headers: Object.fromEntries(headers), agent: false, family: resolved.address.family, lookup, autoSelectFamily: false, signal };
      const request = (resolved.url.protocol === 'https:' ? httpsRequest : httpRequest)(target, options, (incoming: IncomingMessage) => {
        const status = incoming.statusCode ?? 502;
        if (status >= 300 && status < 400) { incoming.destroy(); fail(new ModelGatewayError('endpoint_denied')); return; }
        if (Number(incoming.headers['content-length']) > 16 * 1024 * 1024) { incoming.destroy(); fail(new ModelGatewayError('response_too_large')); return; }
        const responseHeaders = new Headers();
        for (const [key, value] of Object.entries(incoming.headers)) if (value !== undefined) {
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item);
        }
        let stream: Readable = incoming;
        const encoding = responseHeaders.get('content-encoding')?.toLowerCase();
        if (encoding && encoding !== 'identity') {
          const decoder = encoding === 'gzip' ? createGunzip() : encoding === 'br' ? createBrotliDecompress() : encoding === 'deflate' ? createInflate() : null;
          if (!decoder) { incoming.destroy(); fail(new ModelGatewayError('invalid_response')); return; }
          incoming.once('error', error => decoder.destroy(error));
          decoder.once('close', () => incoming.destroy());
          stream = incoming.pipe(decoder);
          responseHeaders.delete('content-encoding'); responseHeaders.delete('content-length');
        }
        stream.once('error', fail);
        try {
          const responseBody = [204, 205, 304].includes(status) ? null : Readable.toWeb(stream) as ReadableStream<Uint8Array>;
          const response = new Response(responseBody, { status, statusText: incoming.statusMessage, headers: responseHeaders });
          settled = true;
          resolve(response);
        } catch { incoming.destroy(); fail(new ModelGatewayError('invalid_response')); }
      });
      request.once('error', fail);
      request.once('upgrade', (_incoming, socket) => { socket.destroy(); fail(new ModelGatewayError('invalid_response')); });
      request.once('close', () => { if (!settled) fail(new ModelGatewayError('invalid_response')); });
      request.setTimeout(45_000, () => request.destroy(new ModelGatewayError('timeout')));
      if (body !== undefined) request.write(body);
      request.end();
    });
  };
}

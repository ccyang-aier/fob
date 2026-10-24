import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Bridges the Bun-native listener onto the Node-style MCP handler. Every MCP
 * response here is a single JSON body (`enableJsonResponse`), so the bridge
 * only needs faithful header/status semantics, not stream plumbing.
 */
export async function handleKnowledgeMcpOnBun(handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const headers: Record<string, string> = {};
  const rawHeaders: string[] = [];
  for (const [key, value] of request.headers) {
    headers[key] = key in headers ? `${headers[key]}, ${value}` : value;
    rawHeaders.push(key, value);
  }
  const body = new Uint8Array(await request.arrayBuffer());

  const nodeRequest = Object.assign(Readable.from([body]), {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    rawHeaders,
  }) as unknown as IncomingMessage;

  let statusCode = 200;
  const sentHeaders = new Map<string, string | string[]>();
  const chunks: Uint8Array[] = [];
  const emitter = new EventEmitter();
  let settled: (() => void) | undefined;
  const finished = new Promise<void>((resolve) => { settled = resolve; });
  const nodeResponse = Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    setHeader(name: string, value: string | string[]) { sentHeaders.set(name.toLowerCase(), value); },
    getHeader(name: string) { return sentHeaders.get(name.toLowerCase()); },
    removeHeader(name: string) { sentHeaders.delete(name.toLowerCase()); },
    writeHead(status: number, part2?: string | Record<string, string | string[]>, part3?: Record<string, string | string[]>) {
      statusCode = status;
      const raw = typeof part2 === 'object' && part2 !== null ? part2 : part3;
      if (raw) for (const [name, value] of Object.entries(raw)) sentHeaders.set(name.toLowerCase(), value);
      this.headersSent = true;
      return this;
    },
    write(chunk: Uint8Array | string) {
      chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
      return true;
    },
    end(chunk?: Uint8Array | string) {
      if (chunk !== undefined) this.write(chunk);
      this.headersSent = true;
      // Node emits 'close' after the response completes; listeners run first.
      queueMicrotask(() => { emitter.emit('close'); settled?.(); });
      return this;
    },
  }) as unknown as ServerResponse;

  await handler(nodeRequest, nodeResponse);
  await finished;
  const flat: [string, string][] = [];
  for (const [name, value] of sentHeaders) {
    if (name === 'set-cookie' && Array.isArray(value)) for (const item of value) flat.push([name, item]);
    else flat.push([name, Array.isArray(value) ? value.join(', ') : value]);
  }
  const bytes = chunks.reduce((total, chunk) => total + chunk.byteLength, 0);
  const merged = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) { merged.set(chunk, offset); offset += chunk.byteLength; }
  return new Response(merged, { status: statusCode, headers: flat });
}

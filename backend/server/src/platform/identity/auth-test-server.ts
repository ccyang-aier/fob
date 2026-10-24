import type { FobSocketTickets } from './socket-tickets';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Hono } from 'hono';
import { createTransport } from 'nodemailer';
import { createResourceTestDatabase } from '../database/resources/resource-test-database';
import { createFobAuth } from './service';
import { createFobAuthRoutes } from './http';
import { createVerificationEmailTransport } from './email';
import type { AuthEmailTransport } from './email';
import { validateFobAuthConfig } from './config';
import { requireFobIdentity } from './identity';
import type { FobOAuthOptions } from './oauth-config';

export const testPassword = 'correct-horse-battery-94';

/** Match a production Node adapter's disconnect semantics without aborting normal completion. */
export function bindAuthTestRequestLifetime(request: IncomingMessage, response: ServerResponse) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const disconnected = () => { if (!response.writableEnded) abort(); };
  request.once('aborted', abort);
  response.once('close', disconnected);
  return {
    signal: controller.signal,
    dispose() {
      request.removeListener('aborted', abort);
      response.removeListener('close', disconnected);
    },
  };
}

/** Real Node HTTP socket + ordinary PostgreSQL role; only email delivery is captured. */
export async function createAuthTestServer(options: {
  crossSite?: boolean;
  socketTickets?: FobSocketTickets;
  email?: AuthEmailTransport;
  oauth?: FobOAuthOptions;
  mount?: (app: Hono, dependencies: { auth: ReturnType<typeof createFobAuth>; database: Awaited<ReturnType<typeof createResourceTestDatabase>> }) => void;
} = {}) {
  const database = await createResourceTestDatabase();
  const captured: { to: { address: string }[]; text: string }[] = [];
  const diagnostics: string[] = [];
  const transport = createTransport({ jsonTransport: true });
  const email = options.email ?? createVerificationEmailTransport('fob@example.test', async (message) => {
    const sent = await transport.sendMail(message);
    if (typeof sent.message !== 'string') throw new Error('Expected a JSON test transport message');
    captured.push(JSON.parse(sent.message));
  });
  const app = new Hono();
  const server = createServer(async (request, response) => {
    const lifetime = bindAuthTestRequestLifetime(request, response);
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [key, value] of Object.entries(request.headers)) {
        if (Array.isArray(value)) for (const item of value) headers.append(key, item);
        else if (value !== undefined) headers.set(key, value);
      }
      const body = Buffer.concat(chunks);
      const input = new Request(`http://${request.headers.host}${request.url}`, { method: request.method, headers, body: body.length ? body : undefined, signal: lifetime.signal });
      const result = await app.fetch(input, { clientAddress: request.socket.remoteAddress });
      if (lifetime.signal.aborted) return;
      response.writeHead(result.status, [...result.headers].filter(([key]) => key !== 'set-cookie').concat(result.headers.getSetCookie().map((value) => ['set-cookie', value])).flat());
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      if (!lifetime.signal.aborted) {
        response.writeHead(500);
        response.end('Test HTTP adapter failed');
      }
    } finally {
      lifetime.dispose();
    }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const webOrigin = options.crossSite ? 'https://app.example.test' : 'http://127.0.0.1:3001';
  const config = validateFobAuthConfig({
    baseUrl: options.crossSite ? 'https://auth.example.test' : origin,
    secret: randomBytes(48).toString('base64'),
    trustedOrigins: [webOrigin],
    cookieMode: options.crossSite ? 'cross-site' : 'same-site',
  });
  // Better Auth's built-in memory map is module-global. Isolate test servers
  // without disabling limits, changing thresholds or spoofing the socket IP.
  const rateCounts = new Map<string, { count: number; expiresAt: number }>();
  const auth = createFobAuth({ pool: database.pool, config, email, oauth: options.oauth, onDiagnostic: (event) => diagnostics.push(event),
    rateLimitStorage: { async consume(key, rule) {
      const now = Date.now();
      const existing = rateCounts.get(key);
      const current = existing && existing.expiresAt > now ? existing : undefined;
      if (current && current.count >= rule.max) return { allowed: false, retryAfter: Math.ceil((current.expiresAt - now) / 1_000) };
      // No await between read and update: the consume step is atomic in this process.
      rateCounts.set(key, { count: (current?.count ?? 0) + 1, expiresAt: now + rule.window * 1_000 });
      return { allowed: true, retryAfter: null };
    } },
  });
  app.route('/', createFobAuthRoutes(auth, (context) => context.env.clientAddress as string, options.socketTickets));
  app.get('/test/identity', requireFobIdentity(auth), (context) => context.json(context.get('identity')));
  app.post('/test/identity', requireFobIdentity(auth), (context) => context.json(context.get('identity')));
  options.mount?.(app, { auth, database });
  return {
    database, auth, origin, webOrigin, captured, diagnostics,
    request(path: string, body?: unknown, cookie?: string, extra: Record<string, string> = {}) {
      return fetch(`${origin}/api/auth${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
        headers: { origin: webOrigin, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(cookie ? { cookie } : {}), ...extra },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    verificationPath(address: string) {
      const message = [...captured].reverse().find((item) => item.to.some((recipient) => recipient.address === address));
      const url = message?.text.match(/https?:\/\/\S+/)?.[0];
      if (!url) throw new Error('Expected a captured verification email');
      const parsed = new URL(url);
      return parsed.pathname.replace('/api/auth', '') + parsed.search;
    },
    async close() {
      await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); server.closeAllConnections(); });
      transport.close();
      await database.dispose();
    },
  };
}

export type AuthTestServer = Awaited<ReturnType<typeof createAuthTestServer>>;
export const responseCookie = (response: Response) => response.headers.getSetCookie().map((value) => value.split(';')[0]).join('; ');

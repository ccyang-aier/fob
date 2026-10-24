import { randomUUID } from 'node:crypto';

/** Single-use, 20-second socket handshake capability. The actual session is
 * revalidated by the resource gate on every connection; ACLs are unchanged. */
export function createFobSocketTickets(now: () => number = Date.now) {
  const tickets = new Map<string, { path: string; cookie: string; origin: string; expiresAt: number }>();
  return {
    issue(path: string, headers: Headers): string | null {
      if (path !== '/' && !/^\/api\/knowledge\/[a-zA-Z0-9-]+\/events\/?$/.test(path)) return null;
      for (const [key, ticket] of tickets) if (ticket.expiresAt <= now()) tickets.delete(key);
      if (tickets.size >= 1024 || !headers.get('cookie')) return null;
      const key = randomUUID();
      tickets.set(key, { path, cookie: headers.get('cookie')!, origin: headers.get('origin')!, expiresAt: now() + 20_000 });
      return key;
    },
    consume(request: Request): Request | null {
      const url = new URL(request.url);
      const key = url.searchParams.get('fob_socket_ticket');
      if (!key) return request;
      const ticket = tickets.get(key);
      tickets.delete(key);
      if (!ticket || ticket.expiresAt <= now() || ticket.path !== url.pathname) return null;
      // Bun can upgrade only the original HTTP Request. Mutate its transport
      // headers rather than replacing it with an unbound Request clone.
      request.headers.set('cookie', ticket.cookie);
      request.headers.set('origin', ticket.origin);
      return request;
    },
  };
}

export type FobSocketTickets = ReturnType<typeof createFobSocketTickets>;

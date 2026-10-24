import { expect, test } from 'bun:test';
import { createFobSocketTickets } from './socket-tickets';

test('Bun upgrades the original ticket-authenticated request and rejects replay', async () => {
  const tickets = createFobSocketTickets();
  const key = tickets.issue('/', new Headers({ cookie: 'session=private', origin: 'http://localhost' }))!;
  const server = Bun.serve({
    port: 0, hostname: '127.0.0.1',
    fetch(request, server) {
      const authorized = tickets.consume(request);
      if (!authorized || authorized.headers.get('cookie') !== 'session=private') return new Response('Forbidden', { status: 403 });
      if (server.upgrade(authorized)) return;
      return new Response('Upgrade failed', { status: 500 });
    },
    websocket: { open(socket) { socket.send('authenticated'); }, message() {} },
  });
  const target = `ws://127.0.0.1:${server.port}/?fob_socket_ticket=${key}`;
  try {
    const result = await new Promise<string>((resolve, reject) => {
      const socket = new WebSocket(target);
      socket.onmessage = (event) => { socket.close(); resolve(String(event.data)); };
      socket.onerror = () => reject(new Error('Ticket handshake rejected'));
    });
    expect(result).toBe('authenticated');
    const replay = await new Promise<boolean>((resolve) => {
      const socket = new WebSocket(target);
      socket.onopen = () => { socket.close(); resolve(false); };
      socket.onerror = () => resolve(true);
    });
    expect(replay).toBe(true);
  } finally { server.stop(true); }
}, 10_000);

import { expect, test } from 'bun:test';
import { createAuthTestServer, responseCookie, testPassword } from './auth-test-server';
import { createFobSocketTickets } from './socket-tickets';
import { getFobIdentity } from './identity';

test('real HTTP socket grants require verified identity and recheck revoked sessions', async () => {
  const tickets = createFobSocketTickets();
  const server = await createAuthTestServer({ socketTickets: tickets });
  try {
    expect((await server.request('/socket-ticket', { path: '/' })).status).toBe(401);
    const email = 'desktop-socket@example.test';
    await server.request('/sign-up/email', { name: 'Desktop', email, password: testPassword });
    const verify = await server.request(server.verificationPath(email));
    expect(verify.status).toBe(302);
    const login = await server.request('/sign-in/email', { email, password: testPassword });
    const cookie = responseCookie(login);
    expect(login.status).toBe(200);
    expect((await server.request('/socket-ticket', { path: '/api/auth/get-session' }, cookie)).status).toBe(400);
    const granted = await server.request('/socket-ticket', { path: '/' }, cookie);
    expect(granted.status).toBe(200);
    const { ticket } = await granted.json() as { ticket: string };
    expect(ticket).not.toContain(cookie);
    const request = tickets.consume(new Request(`${server.origin}/?fob_socket_ticket=${ticket}`))!;
    expect(await getFobIdentity(server.auth, request.headers)).not.toBeNull();
    await server.request('/sign-out', {}, cookie);
    expect(await getFobIdentity(server.auth, request.headers)).toBeNull();
  } finally { await server.close(); }
}, 30_000);

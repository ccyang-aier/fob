import { expect, test } from 'bun:test';
import { createFobSocketTickets } from './socket-tickets';

test('socket grants expire, bind the path, cannot replay, and never disclose the session cookie', () => {
  let now = 1000;
  const tickets = createFobSocketTickets(() => now);
  const headers = new Headers({ cookie: 'session=private', origin: 'https://api.fob.test' });
  const ticket = tickets.issue('/', headers)!;
  expect(ticket).not.toContain('private');
  const request = new Request(`https://api.fob.test/?fob_socket_ticket=${ticket}`);
  const authorized = tickets.consume(request)!;
  expect(authorized.headers.get('cookie')).toBe('session=private');
  expect(authorized).toBe(request);
  expect(tickets.consume(request)).toBeNull();
  const expired = tickets.issue('/', headers);
  now += 20_000;
  expect(tickets.consume(new Request(`https://api.fob.test/?fob_socket_ticket=${expired}`))).toBeNull();
  const bound = tickets.issue('/api/knowledge/knowledgeBase/events', headers);
  expect(tickets.consume(new Request(`https://api.fob.test/?fob_socket_ticket=${bound}`))).toBeNull();
  expect(tickets.issue('/api/auth/get-session', headers)).toBeNull();
  expect(tickets.issue('/', new Headers())).toBeNull();
});

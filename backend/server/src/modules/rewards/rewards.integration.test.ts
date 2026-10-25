import { afterAll, beforeAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { beijingDay, previousCoffeeDay } from '@fob/shared/rewards';
import type { CoffeeCheckInResult, CoffeeLedgerPage, CoffeeSummary } from '@fob/shared/rewards';
import { readFobDatabaseConnections } from '../../platform/database/initialize-config';
import { withFobAccount } from '../../platform/database/resources/transaction';
import { createAuthTestServer, responseCookie, testPassword } from '../../platform/identity/auth-test-server';
import type { AuthTestServer } from '../../platform/identity/auth-test-server';
import type { FobIdentity } from '../../platform/identity/identity';
import { createRewardsRoutes } from './http';
import { createRewardsService } from './service';

let server: AuthTestServer, pool: Pool, service: ReturnType<typeof createRewardsService>;
type Actor = { cookie: string; identity: FobIdentity };
let alpha: Actor, beta: Actor;
async function actor(name: string): Promise<Actor> {
  const email = `${randomUUID()}@rewards.test`;
  expect((await server.request('/sign-up/email', { name, email, password: testPassword })).status).toBe(200);
  expect((await server.request(server.verificationPath(email))).status).toBe(302);
  const login = await server.request('/sign-in/email', { email, password: testPassword });
  expect(login.status).toBe(200);
  const cookie = responseCookie(login);
  const identity = await (await fetch(`${server.origin}/test/identity`, { headers: { cookie, origin: server.webOrigin } })).json() as FobIdentity;
  return { cookie, identity };
}
function request(path = '', account?: Actor, method = 'GET', body?: unknown, origin?: string) {
  return fetch(`${server.origin}/api/rewards/coffee${path}`, {
    method, headers: { origin: origin ?? server.webOrigin, ...(account ? { cookie: account.cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
beforeAll(async () => {
  const connections = await readFobDatabaseConnections();
  server = await createAuthTestServer({ mount(app, { auth, database }) {
    const application = new URL(connections.application);
    application.pathname = `/${database.name}`;
    pool = new Pool({ connectionString: application.toString(), max: 8, connectionTimeoutMillis: 10_000 });
    pool.on('error', () => {});
    service = createRewardsService(pool);
    app.route('/', createRewardsRoutes(auth, service));
  } });
  alpha = await actor('Coffee Alpha'); beta = await actor('Coffee Beta');
}, 40_000);
afterAll(async () => { await pool?.end(); await server?.close(); }, 30_000);

test('real verified HTTP accounts begin at zero; anonymous and untrusted requests are rejected', async () => {
  const response = await request('', alpha);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ accountId: alpha.identity.userId, balance: 0, checkedInToday: false });
  expect((await request()).status).toBe(401);
  expect((await request('/check-in', undefined, 'POST', {})).status).toBe(401);
  expect((await request('/check-in', alpha, 'POST', {}, 'https://untrusted.test')).status).toBe(403);
});

test('eight concurrent HTTP check-ins award exactly one real cup and retries are idempotent', async () => {
  const responses = await Promise.all(Array.from({ length: 8 }, () => request('/check-in', alpha, 'POST', {})));
  expect(responses.map(response => response.status)).toEqual(Array(8).fill(200));
  const results = await Promise.all(responses.map(response => response.json() as Promise<CoffeeCheckInResult>));
  expect(results.filter(result => result.awarded)).toHaveLength(1);
  expect(results.every(result => result.balance === 1 && result.checkedInToday && result.accountId === alpha.identity.userId)).toBe(true);
  const retry = await request('/check-in', alpha, 'POST', {});
  expect(await retry.json()).toMatchObject({ awarded: false, balance: 1 });
  const persisted = await server.database.admin.query('SELECT amount,kind,day::text FROM resources.coffee_ledger WHERE user_id=$1', [alpha.identity.userId]);
  expect(persisted.rows).toEqual([{ amount: 1, kind: 'daily_check_in', day: results[0]!.today }]);
});

test('account isolation ignores discovery spoofing and rejects client-created awards', async () => {
  expect(await (await request(`?userId=${alpha.identity.userId}`, beta)).json()).toMatchObject({ accountId: beta.identity.userId, balance: 0 });
  for (const body of [{ userId: beta.identity.userId }, { day: '2000-01-01' }, { amount: 10 }, { balance: 99 }]) {
    expect((await request('/check-in', alpha, 'POST', body)).status).toBe(400);
  }
  const own = await request('/check-in', beta, 'POST', {});
  expect(await own.json()).toMatchObject({ accountId: beta.identity.userId, balance: 1, awarded: true });
  await expect(service.checkIn({ ...alpha.identity, userId: beta.identity.userId }, {})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  expect((await service.summary(alpha.identity)).balance).toBe(1);
});

test('ordinary database role can read only its account and cannot edit, erase, backdate or credit another account', async () => {
  const selected = await withFobAccount(pool, alpha.identity.sessionId, db => db.execute<{ user_id: string }>(sql`SELECT user_id FROM resources.coffee_ledger`));
  expect(selected.rows).toEqual([{ user_id: alpha.identity.userId }]);
  const changed = await withFobAccount(pool, alpha.identity.sessionId, db => db.execute(sql`UPDATE resources.coffee_ledger SET amount=1 RETURNING id`));
  const removed = await withFobAccount(pool, alpha.identity.sessionId, db => db.execute(sql`DELETE FROM resources.coffee_ledger RETURNING id`));
  expect(changed.rows).toHaveLength(0); expect(removed.rows).toHaveLength(0);
  await expect(withFobAccount(pool, alpha.identity.sessionId, db => db.execute(sql`INSERT INTO resources.coffee_ledger(id,user_id,day) VALUES (${randomUUID()},${beta.identity.userId},(clock_timestamp() AT TIME ZONE 'Asia/Shanghai')::date)`))).rejects.toMatchObject({ cause: { code: '42501' } });
  await expect(withFobAccount(pool, alpha.identity.sessionId, db => db.execute(sql`INSERT INTO resources.coffee_ledger(id,user_id,day,created_at) VALUES (${randomUUID()},${alpha.identity.userId},'2000-01-01','2000-01-01T04:00:00Z')`))).rejects.toMatchObject({ cause: { code: '42501' } });
  expect((await service.summary(alpha.identity)).balance).toBe(1);
});

test('ledger pagination uses only the current account and rejects a foreign cursor', async () => {
  const now = new Date((await server.database.admin.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]!.now);
  let day = beijingDay(now);
  for (let index = 0; index < 3; index++) {
    day = previousCoffeeDay(day);
    await server.database.admin.query('INSERT INTO resources.coffee_ledger(id,user_id,day,created_at) VALUES ($1,$2,$3,$4)', [randomUUID(), alpha.identity.userId, day, `${day}T04:00:00Z`]);
  }
  const first = await (await request('/ledger?limit=2', alpha)).json() as CoffeeLedgerPage;
  expect(first.accountId).toBe(alpha.identity.userId); expect(first.items).toHaveLength(2); expect(first.nextCursor).not.toBeNull();
  const second = await (await request(`/ledger?limit=2&cursor=${first.nextCursor}`, alpha)).json() as CoffeeLedgerPage;
  expect(second.items).toHaveLength(2); expect(second.nextCursor).toBeNull();
  expect(new Set([...first.items, ...second.items].map(item => item.id)).size).toBe(4);
  const foreign = await (await request('/ledger', beta)).json() as CoffeeLedgerPage;
  expect((await request(`/ledger?cursor=${foreign.items[0]!.id}`, alpha)).status).toBe(400);
  const summary = await (await request('', alpha)).json() as CoffeeSummary;
  expect(summary.balance).toBe(4); expect(summary.currentStreak).toBe(4);
});

test('revoked real sessions cannot claim or use the account transaction', async () => {
  expect((await server.request('/sign-out', {}, beta.cookie)).status).toBe(200);
  expect((await request('/check-in', beta, 'POST', {})).status).toBe(401);
  await expect(service.summary(beta.identity)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});

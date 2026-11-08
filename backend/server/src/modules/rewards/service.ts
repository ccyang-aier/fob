import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { beijingDay, coffeeCheckInInputSchema, coffeeLedgerInputSchema, coffeeSummaryFromDays } from '@fob/shared/rewards';
import type { CoffeeCheckInResult, CoffeeLedgerEntry, CoffeeLedgerPage, CoffeeSummary } from '@fob/shared/rewards';
import { coffeeLedger } from '../../platform/database/resources/schema/rewards';
import { withFobAccount } from '../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../platform/database/resources/transaction';
import type { FobIdentity } from '../../platform/identity/identity';
import { currentIdentity, pageOf } from '../../platform/resources/context';
import { ResourceRequestError } from '../../platform/resources/errors';
import { readCoffeeBalance } from './wallet';

async function databaseTime(db: ResourceTransaction): Promise<Date> {
  const result = await db.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(result.rows[0]!.now);
}

async function readSummary(db: ResourceTransaction, userId: string, now: Date): Promise<CoffeeSummary> {
  const entries = await db.select({ day: coffeeLedger.day }).from(coffeeLedger).where(eq(coffeeLedger.userId, userId));
  return { accountId: userId, ...coffeeSummaryFromDays(entries.map(entry => entry.day), now), balance: await readCoffeeBalance(db, userId) };
}

function parseInput<T>(schema: { safeParse: (input: unknown) => { success: boolean; data?: T } }, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ResourceRequestError('INVALID_INPUT', 'Invalid rewards request.', 400);
  return parsed.data!;
}

export function createRewardsService(pool: Pool) {
  async function inAccount<T>(identity: FobIdentity, write: boolean, operation: (db: ResourceTransaction, userId: string) => Promise<T>) {
    return withFobAccount(pool, identity.sessionId, async db => {
      const actor = await currentIdentity(db, identity, write);
      return operation(db, actor.userId);
    });
  }
  return {
    summary(identity: FobIdentity) {
      return inAccount(identity, false, async (db, userId) => readSummary(db, userId, await databaseTime(db)));
    },
    checkIn(identity: FobIdentity, input: unknown): Promise<CoffeeCheckInResult> {
      parseInput(coffeeCheckInInputSchema, input);
      return inAccount(identity, true, async (db, userId) => {
        // The same timestamp determines eligibility and the immutable ledger day.
        const now = await databaseTime(db);
        const inserted = await db.insert(coffeeLedger).values({ id: randomUUID(), userId, day: beijingDay(now), amount: 1, kind: 'daily_check_in', createdAt: now })
          .onConflictDoNothing({ target: [coffeeLedger.userId, coffeeLedger.day] }).returning({ id: coffeeLedger.id });
        // A conflict waits for the winning insert. This next READ COMMITTED
        // statement sees its committed award, so retries report the real balance.
        return { ...await readSummary(db, userId, now), awarded: inserted.length === 1, reward: 1 };
      });
    },
    ledger(identity: FobIdentity, input: unknown = {}): Promise<CoffeeLedgerPage> {
      const { cursor, limit } = parseInput<ReturnType<typeof coffeeLedgerInputSchema.parse>>(coffeeLedgerInputSchema, input);
      return inAccount(identity, false, async (db, userId) => {
        const source = sql`entries AS (
          SELECT id,created_at,amount,'daily_check_in'::text AS kind FROM resources.coffee_ledger WHERE user_id=${userId}::uuid
          UNION ALL SELECT id,created_at,CASE WHEN sender_id=${userId}::uuid THEN -amount ELSE amount END,
            CASE WHEN sender_id=${userId}::uuid THEN 'coffee_sent' ELSE 'coffee_received' END
            FROM resources.coffee_transfer WHERE sender_id=${userId}::uuid OR recipient_id=${userId}::uuid
        )`;
        let anchor: { id: string; at: string } | undefined;
        if (cursor) {
          [anchor] = (await db.execute<{ id: string; at: string }>(sql`WITH ${source} SELECT id,created_at::text AS at FROM entries WHERE id=${cursor}::uuid`)).rows;
          if (!anchor) throw new ResourceRequestError('INVALID_INPUT', 'Ledger cursor is not available.', 400);
        }
        const rows = (await db.execute<{ id: string; created_at: Date; amount: number; kind: CoffeeLedgerEntry['kind'] }>(sql`WITH ${source}
          SELECT * FROM entries WHERE ${anchor ? sql`(created_at,id)<(${anchor.at}::timestamptz,${anchor.id}::uuid)` : sql`true`}
          ORDER BY created_at DESC,id DESC LIMIT ${limit + 1}`)).rows;
        const entries: CoffeeLedgerEntry[] = rows.map(row => ({ id: row.id, day: beijingDay(new Date(row.created_at)), amount: row.amount, kind: row.kind, createdAt: new Date(row.created_at).toISOString() }));
        return { accountId: userId, ...pageOf(entries, limit, entry => entry.id) };
      });
    },
  };
}

export type RewardsService = ReturnType<typeof createRewardsService>;

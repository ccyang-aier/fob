import { randomUUID } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { beijingDay, coffeeCheckInInputSchema, coffeeLedgerInputSchema, coffeeSummaryFromDays } from '@fob/shared/rewards';
import type { CoffeeCheckInResult, CoffeeLedgerEntry, CoffeeLedgerPage, CoffeeSummary } from '@fob/shared/rewards';
import { coffeeLedger } from '../../platform/database/resources/schema/rewards';
import { withFobAccount } from '../../platform/database/resources/transaction';
import type { ResourceTransaction } from '../../platform/database/resources/transaction';
import type { FobIdentity } from '../../platform/identity/identity';
import { currentIdentity, pageOf } from '../../platform/resources/context';
import { ResourceRequestError } from '../../platform/resources/errors';

async function databaseTime(db: ResourceTransaction): Promise<Date> {
  const result = await db.execute<{ now: Date }>(sql`SELECT clock_timestamp() AS now`);
  return new Date(result.rows[0]!.now);
}

async function readSummary(db: ResourceTransaction, userId: string, now: Date): Promise<CoffeeSummary> {
  const entries = await db.select({ day: coffeeLedger.day }).from(coffeeLedger).where(eq(coffeeLedger.userId, userId));
  return { accountId: userId, ...coffeeSummaryFromDays(entries.map(entry => entry.day), now) };
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
        let beforeDay: string | undefined;
        if (cursor) {
          const [entry] = await db.select({ day: coffeeLedger.day }).from(coffeeLedger).where(and(eq(coffeeLedger.userId, userId), eq(coffeeLedger.id, cursor)));
          if (!entry) throw new ResourceRequestError('INVALID_INPUT', 'Ledger cursor is not available.', 400);
          beforeDay = entry.day;
        }
        const rows = await db.select().from(coffeeLedger).where(and(eq(coffeeLedger.userId, userId), beforeDay ? lt(coffeeLedger.day, beforeDay) : undefined))
          .orderBy(desc(coffeeLedger.day)).limit(limit + 1);
        const entries: CoffeeLedgerEntry[] = rows.map(row => ({ id: row.id, day: row.day, amount: 1, kind: 'daily_check_in', createdAt: row.createdAt.toISOString() }));
        return { accountId: userId, ...pageOf(entries, limit, entry => entry.id) };
      });
    },
  };
}

export type RewardsService = ReturnType<typeof createRewardsService>;

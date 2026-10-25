import { sql } from 'drizzle-orm';
import { check, date, smallint, unique, uuid, varchar } from 'drizzle-orm/pg-core';
import { authUser } from '../../identity/schema';
import { resourcesNamespace } from './namespaces';
import { instant } from './types';

/** Account-owned append-only awards. Balance is derived from this ledger. */
export const coffeeLedger = resourcesNamespace.table('coffee_ledger', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id').notNull().references(() => authUser.id),
  day: date('day', { mode: 'string' }).notNull(),
  amount: smallint('amount').notNull().default(1),
  kind: varchar('kind', { length: 32 }).notNull().default('daily_check_in'),
  createdAt: instant('created_at').notNull().defaultNow(),
}, table => [
  unique('coffee_ledger_account_day_unique').on(table.userId, table.day),
  check('coffee_ledger_daily_amount', sql`${table.amount} = 1`),
  check('coffee_ledger_daily_kind', sql`${table.kind} = 'daily_check_in'`),
  check('coffee_ledger_beijing_day', sql`${table.day} = (${table.createdAt} AT TIME ZONE 'Asia/Shanghai')::date`),
]);

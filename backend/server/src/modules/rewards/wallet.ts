import { sql } from 'drizzle-orm';
import type { ResourceTransaction } from '../../platform/database/resources/transaction';

/** Call inside a verified account transaction so RLS includes transfers across libraries. */
export async function readCoffeeBalance(db: ResourceTransaction, userId: string): Promise<number> {
  const [row] = (await db.execute<{ balance: number }>(sql`SELECT (
    (SELECT count(*) FROM resources.coffee_ledger WHERE user_id=${userId}::uuid)
    + coalesce((SELECT sum(CASE WHEN recipient_id=${userId}::uuid THEN amount ELSE -amount END)
      FROM resources.coffee_transfer WHERE sender_id=${userId}::uuid OR recipient_id=${userId}::uuid),0)
  )::int AS balance`)).rows;
  return row?.balance ?? 0;
}

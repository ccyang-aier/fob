import { z } from 'zod';

export const rewardsApiBase = '/api/rewards/coffee';
export const coffeeDaySchema = z.iso.date();
export const coffeeLedgerEntrySchema = z.object({
  id: z.uuid(),
  day: coffeeDaySchema,
  amount: z.literal(1),
  kind: z.literal('daily_check_in'),
  createdAt: z.iso.datetime(),
}).strict();
export const coffeeSummarySchema = z.object({
  accountId: z.uuid(),
  balance: z.number().int().nonnegative(),
  checkedInToday: z.boolean(),
  currentStreak: z.number().int().nonnegative(),
  today: coffeeDaySchema,
  month: z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), checkIns: z.number().int().nonnegative(), days: z.number().int().min(28).max(31) }).strict(),
  recentCheckIns: z.array(coffeeDaySchema),
  serverTime: z.iso.datetime(),
}).strict();
export const coffeeCheckInResultSchema = coffeeSummarySchema.extend({ awarded: z.boolean(), reward: z.literal(1) });
export const coffeeLedgerPageSchema = z.object({ accountId: z.uuid(), items: z.array(coffeeLedgerEntrySchema), nextCursor: z.uuid().nullable() }).strict();
export const coffeeCheckInInputSchema = z.object({}).strict();
export const coffeeLedgerInputSchema = z.object({ cursor: z.uuid().optional(), limit: z.number().int().min(1).max(50).default(20) }).strict();
export type CoffeeSummary = z.infer<typeof coffeeSummarySchema>;
export type CoffeeCheckInResult = z.infer<typeof coffeeCheckInResultSchema>;
export type CoffeeLedgerEntry = z.infer<typeof coffeeLedgerEntrySchema>;
export type CoffeeLedgerPage = z.infer<typeof coffeeLedgerPageSchema>;

/** Beijing's current civil-day boundary; never use the browser's local date for eligibility. */
export function beijingDay(now: Date): string {
  return new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString().slice(0, 10);
}

export function previousCoffeeDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** Each persisted entry is exactly one cup. Missing days never create an award. */
export function coffeeSummaryFromDays(days: readonly string[], now: Date): Omit<CoffeeSummary, 'accountId'> {
  const today = beijingDay(now), month = today.slice(0, 7);
  const unique = new Set(days);
  const checkedInToday = unique.has(today);
  let currentStreak = 0, cursor = checkedInToday ? today : previousCoffeeDay(today);
  while (unique.has(cursor)) { currentStreak++; cursor = previousCoffeeDay(cursor); }
  const recentCheckIns = [...unique].filter(day => day.startsWith(month)).sort();
  return {
    balance: days.length,
    checkedInToday,
    currentStreak,
    today,
    month: { month, checkIns: recentCheckIns.length, days: new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0)).getUTCDate() },
    recentCheckIns,
    serverTime: now.toISOString(),
  };
}

import { expect, test } from 'bun:test';
import { beijingDay, coffeeCheckInInputSchema, coffeeLedgerInputSchema, coffeeSummaryFromDays, previousCoffeeDay } from './index';

test('daily eligibility turns over exactly at Beijing midnight, independently of host timezone', () => {
  expect(beijingDay(new Date('2026-10-25T15:59:59.999Z'))).toBe('2026-10-25');
  expect(beijingDay(new Date('2026-10-25T16:00:00.000Z'))).toBe('2026-10-26');
  expect(previousCoffeeDay('2024-03-01')).toBe('2024-02-29');
});

test('streak and monthly progress are derived from actual entries across month boundaries', () => {
  const summary = coffeeSummaryFromDays(['2024-02-28', '2024-02-29', '2024-03-01', '2024-01-01'], new Date('2024-03-01T12:00:00Z'));
  expect(summary.balance).toBe(4);
  expect(summary.currentStreak).toBe(3);
  expect(summary.month).toEqual({ month: '2024-03', checkIns: 1, days: 31 });
  expect(summary.recentCheckIns).toEqual(['2024-03-01']);
  expect(summary.checkedInToday).toBe(true);
  expect(coffeeSummaryFromDays(['2024-02-28', '2024-02-29'], new Date('2024-03-01T12:00:00Z')).currentStreak).toBe(2);
  expect(coffeeSummaryFromDays(['2024-02-28'], new Date('2024-03-01T12:00:00Z')).currentStreak).toBe(0);
});

test('empty accounts have a real zero balance and February has its actual day count', () => {
  expect(coffeeSummaryFromDays([], new Date('2024-02-10T12:00:00Z'))).toMatchObject({ balance: 0, checkedInToday: false, currentStreak: 0, month: { checkIns: 0, days: 29 }, recentCheckIns: [] });
});

test('clients cannot supply award amounts, accounts or days and pagination stays bounded', () => {
  expect(coffeeCheckInInputSchema.safeParse({}).success).toBe(true);
  for (const input of [{ userId: 'another-account' }, { day: '2026-10-24' }, { amount: 100 }, { balance: 99 }]) {
    expect(coffeeCheckInInputSchema.safeParse(input).success).toBe(false);
  }
  expect(coffeeLedgerInputSchema.parse({})).toEqual({ limit: 20 });
  expect(coffeeLedgerInputSchema.safeParse({ limit: 51 }).success).toBe(false);
  expect(coffeeLedgerInputSchema.safeParse({ userId: 'another-account' }).success).toBe(false);
});

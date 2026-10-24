import { expect, test } from 'bun:test';
import { dateKey, initialSelection, monthDays, monthStart, parseDay, pickerValue, withinBounds } from './date-picker-model';

test('calendar values preserve local days and reject nonexistent dates', () => {
  expect(dateKey(parseDay('2028-02-29')!)).toBe('2028-02-29');
  expect(parseDay('2027-02-29')).toBeNull();
  expect(parseDay('2026-04-31')).toBeNull();
  expect(parseDay('2026-13-01')).toBeNull();
  expect(dateKey(parseDay('0099-01-01')!)).toBe('0099-01-01');
});

test('six Monday-first weeks include adjacent months and year boundaries', () => {
  const days = monthDays(parseDay('2027-01-21')!);
  expect(days).toHaveLength(42);
  expect(days[0].getDay()).toBe(1);
  expect(dateKey(days[0])).toBe('2026-12-28');
  expect(dateKey(days[41])).toBe('2027-02-07');
  expect(new Set(days.map(dateKey)).size).toBe(42);
  expect(dateKey(monthStart(parseDay('2028-03-31')!, -1))).toBe('2028-02-01');
});

test('local datetime values retain seconds and respect inclusive bounds', () => {
  expect(initialSelection('2026-10-22T10:17:43')).toEqual({ day: '2026-10-22', time: '10:17:43' });
  expect(pickerValue('2026-10-22', '10:17:43', 'datetime-local')).toBe('2026-10-22T10:17:43');
  expect(pickerValue('2026-10-22', '10:17:43', 'date')).toBe('2026-10-22');
  expect(withinBounds('2026-10-22T10:17', '2026-10-22T10:17:00', '2026-10-22T10:17:00')).toBe(true);
  expect(withinBounds('2026-10-22T10:16:59', '2026-10-22T10:17')).toBe(false);
  expect(withinBounds('2026-10-23', undefined, '2026-10-22')).toBe(false);
});

export type DatePickerType = 'date' | 'datetime-local';

const pad = (value: number) => String(value).padStart(2, '0');

/** Use local calendar days throughout; converting them through UTC shifts dates. */
export function dateKey(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function parseDay(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(12, 0, 0, 0);
  return year > 0 && dateKey(date) === value ? date : null;
}

export function shiftDay(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function monthStart(date: Date, offset = 0): Date {
  const next = new Date(date);
  next.setDate(1);
  next.setMonth(next.getMonth() + offset);
  return next;
}

export function monthDays(month: Date): Date[] {
  const first = monthStart(month);
  const monday = shiftDay(first, -(first.getDay() + 6) % 7);
  return Array.from({ length: 42 }, (_, index) => shiftDay(monday, index));
}

export function pickerValue(day: string, time: string, type: DatePickerType): string {
  return type === 'date' ? day : `${day}T${time}`;
}

export function withinBounds(value: string, min?: string, max?: string): boolean {
  // Canonical local values compare chronologically, including second precision.
  const normalized = value.length === 16 ? `${value}:00` : value;
  return (!min || normalized >= (min.length === 16 ? `${min}:00` : min))
    && (!max || normalized <= (max.length === 16 ? `${max}:00` : max));
}

export function initialSelection(value: string, min?: string, max?: string) {
  const today = dateKey(new Date());
  const day = parseDay(value.slice(0, 10)) ? value.slice(0, 10)
    : min && today < min.slice(0, 10) ? min.slice(0, 10)
    : max && today > max.slice(0, 10) ? max.slice(0, 10) : today;
  return { day, time: /^\d{2}:\d{2}(:\d{2})?$/.test(value.slice(11)) ? value.slice(11) : '09:00' };
}

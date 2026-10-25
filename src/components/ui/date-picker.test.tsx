import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DatePicker as Picker, DatePickerProps } from './date-picker';

let browser: Window, root: Root, host: HTMLDivElement;
let DatePicker: typeof Picker;
const changed = mock((value: string) => value);
const parentEscape = mock(() => {});

function Fixture({ value: initial = '2026-10-21', ...props }: Partial<DatePickerProps>) {
  const [value, setValue] = useState(initial);
  return <form onKeyDown={event => { if (event.key === 'Escape') parentEscape(); }}>
    <DatePicker {...props} name="date" aria-label="Deadline" value={value} onValueChange={next => { changed(next); setValue(next); }} />
    <input id="outside" aria-label="Outside" />
  </form>;
}

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'FocusEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'ResizeObserver', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  browser.localStorage.setItem('fob.language', 'en-US');
  const icon = () => <svg aria-hidden />;
  mock.module('@/components/icons', () => ({ CalendarBlank: icon, CaretLeft: icon, CaretRight: icon, X: icon }));
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => document.body }));
  ({ DatePicker } = await import('./date-picker'));
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});

beforeEach(async () => { await act(async () => root.render(null)); changed.mockClear(); parentEscape.mockClear(); });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });

const trigger = () => host.querySelector<HTMLButtonElement>('[role="combobox"]')!;
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');
const button = (label: string) => [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === label)!;
const day = (value: string) => panel()!.querySelector<HTMLButtonElement>(`[data-day="${value}"]`)!;
async function render(props: Partial<DatePickerProps> = {}) { await act(async () => root.render(<Fixture {...props} />)); }
async function open() { await act(async () => trigger().click()); }

test('date selection stays a draft until confirmed; cancel and Escape preserve the field', async () => {
  await render(); await open();
  await act(async () => day('2026-10-23').click());
  expect(changed.mock.calls.length).toBe(0);
  await act(async () => button('Cancel').click());
  expect(panel()).toBeNull(); expect(trigger().textContent).toContain('10/21/2026');
  expect(document.activeElement).toBe(trigger());
  await open(); await act(async () => day('2026-10-23').click());
  await act(async () => button('Schedule').click());
  expect(changed.mock.calls).toEqual([['2026-10-23']]);
  expect(host.querySelector<HTMLInputElement>('input[name="date"]')!.value).toBe('2026-10-23');
  await open();
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(panel()).toBeNull(); expect(parentEscape.mock.calls.length).toBe(0);
  expect(document.activeElement).toBe(trigger());
});

test('outside focus dismisses without saving or stealing focus; optional dates clear', async () => {
  await render(); await open();
  await act(async () => day('2026-10-24').click());
  const outside = host.querySelector<HTMLInputElement>('#outside')!;
  await act(async () => { outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); outside.focus(); });
  expect(panel()).toBeNull(); expect(changed.mock.calls.length).toBe(0); expect(document.activeElement).toBe(outside);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Clear date"]')!.click());
  expect(changed.mock.calls).toEqual([['']]); expect(trigger().textContent).toContain('Choose a date');
});

test('date/time lists and exact input preserve second precision on confirmation', async () => {
  await render({ type: 'datetime-local', value: '2026-10-21T09:17:43', step: 1, required: true }); await open();
  expect(panel()!.querySelector('[role="option"][aria-selected="true"]')!.textContent).toContain('9:17');
  expect(panel()!.querySelector<HTMLInputElement>('input[type="time"]')!.value).toBe('09:17:43');
  await act(async () => day('2026-10-22').click());
  await act(async () => button('Schedule').click());
  expect(changed.mock.calls).toEqual([['2026-10-22T09:17:43']]);
});

test('date-only fields share the time layout while retaining date-only values and bounds', async () => {
  await render({ min: '2026-10-21', max: '2026-10-21' }); await open();
  const options = [...panel()!.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  expect(options).toHaveLength(48);
  expect(panel()!.querySelector('input[type="time"]')).not.toBeNull();
  const ten = options.find(item => item.textContent === '10:00 AM')!;
  expect(ten.disabled).toBe(false);
  await act(async () => ten.click());
  expect(changed.mock.calls.length).toBe(0);
  await act(async () => button('Schedule').click());
  expect(changed.mock.calls).toEqual([['2026-10-21']]);
});

test('bounds disable unavailable days and times; required and read-only controls cannot clear', async () => {
  await render({ type: 'datetime-local', value: '2026-10-21T10:00', min: '2026-10-21T10:00', max: '2026-10-22T11:00', required: true }); await open();
  expect(day('2026-10-20').disabled).toBe(true);
  const nine = [...panel()!.querySelectorAll<HTMLButtonElement>('[role="option"]')].find(item => item.textContent === '9:00 AM')!;
  expect(nine.disabled).toBe(true);
  expect(host.querySelector('[aria-label="Clear date"]')).toBeNull();
  await act(async () => button('Cancel').click());
  await render({ readOnly: true }); expect(trigger().disabled).toBe(true); expect(panel()).toBeNull();
});

test('arrow and page keys move grid focus across month/year boundaries without saving', async () => {
  await render({ value: '2026-12-31' }); await open();
  await act(async () => day('2026-12-31').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })));
  expect(document.activeElement?.getAttribute('data-day')).toBe('2027-01-01');
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true })));
  expect(document.activeElement?.getAttribute('data-day')).toBe('2027-02-01');
  expect(changed.mock.calls.length).toBe(0);
});

test('required values retain native form validation and focus the visible picker', async () => {
  await render({ value: '', required: true });
  await act(async () => { expect(host.querySelector('form')!.checkValidity()).toBe(false); });
  expect(panel()).not.toBeNull();
  await act(async () => button('Schedule').click());
  expect(host.querySelector('form')!.checkValidity()).toBe(true);
  expect(changed.mock.calls.length).toBe(1);
});

import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient } from '@tanstack/react-query';
import { coffeeSummaryFromDays } from '@fob/shared/rewards';
import type { CoffeeCheckInResult } from '@fob/shared/rewards';
import { setLocale } from '@/lib/i18n';
import type { useCoffeeRewards } from './rewards-provider';
import type { CoffeeBalanceButton as CoffeeButton } from './coffee-balance-button';

type Rewards = ReturnType<typeof useCoffeeRewards>;
let browser: Window, root: Root, CoffeeBalanceButton: typeof CoffeeButton;
let rewards: Rewards, claims = 0, signIns = 0, retries = 0;
const summary = (days = ['2026-10-31']) => ({ accountId: 'account-a', ...coffeeSummaryFromDays(days, new Date('2026-11-01T04:00:00Z')) });
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/?folder=research' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent', 'ResizeObserver', 'MutationObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  setLocale('zh-CN');
  mock.module('./rewards-provider', () => ({ useCoffeeRewards: () => rewards }));
  ({ CoffeeBalanceButton } = await import('./coffee-balance-button'));
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  claims = 0; signIns = 0; retries = 0;
  rewards = { accountId: null, principal: 'anonymous', identityStatus: 'anonymous', summary: undefined, loading: false, error: null, checkingIn: false, checkIn: async () => { claims++; return undefined; }, refresh: () => { retries++; }, openSignIn: () => { signIns++; }, client: new QueryClient() };
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render() { await act(async () => root.render(<CoffeeBalanceButton />)); }
const trigger = () => document.querySelector<HTMLButtonElement>('button[aria-haspopup="dialog"]')!;
const panel = () => document.querySelector<HTMLElement>('[role="dialog"]');
async function wait(ms: number) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
function authenticate() { rewards = { ...rewards, accountId: 'account-a', principal: 'account-a:session', identityStatus: 'authenticated', summary: summary() }; }

test('anonymous users see no invented balance and login leaves the folder route intact', async () => {
  await render();
  await act(async () => trigger().click());
  expect(panel()?.textContent).toContain('登录后查看');
  expect(panel()?.querySelector('strong')).toBeNull();
  expect(panel()?.textContent).toContain('咖啡券暂未开放');
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button')!.click());
  expect(signIns).toBe(1); expect(claims).toBe(0); expect(panel()).toBeNull();
  expect(window.location.search).toBe('?folder=research');
});

test('hover opens without stealing editor focus and allows moving into the panel', async () => {
  authenticate(); await render();
  const outside = document.createElement('input'); document.body.append(outside); outside.focus();
  await act(async () => trigger().dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true })));
  await wait(150);
  expect(panel()).not.toBeNull(); expect(document.activeElement).toBe(outside);
  await act(async () => {
    trigger().dispatchEvent(new PointerEvent('pointerout', { pointerType: 'mouse', bubbles: true, relatedTarget: panel() }));
    trigger().dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: panel() }));
    panel()!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: trigger() }));
  });
  await wait(250); expect(panel()).not.toBeNull();
  await act(async () => panel()!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: outside })));
  await wait(250); expect(panel()).toBeNull(); outside.remove();
});

test('click pins an existing hover panel; Escape and outside clicks dismiss without navigation', async () => {
  authenticate(); await render();
  await act(async () => trigger().dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true })));
  await wait(150);
  expect(panel()).not.toBeNull();
  await act(async () => trigger().click());
  expect(panel()).not.toBeNull();
  await act(async () => trigger().dispatchEvent(new PointerEvent('pointerout', { pointerType: 'mouse', bubbles: true, relatedTarget: document.body })));
  await wait(250); expect(panel()).not.toBeNull();
  await act(async () => panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(panel()).toBeNull(); expect(document.activeElement).toBe(trigger());
  await act(async () => trigger().click());
  await act(async () => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  expect(panel()).toBeNull(); expect(window.location.search).toBe('?folder=research');
});

test('check-in keeps its label without loading, ignores repeats and celebrates only the confirmed award', async () => {
  authenticate();
  let complete!: (value: CoffeeCheckInResult) => void;
  const pending = new Promise<CoffeeCheckInResult>(resolve => { complete = resolve; });
  rewards.checkIn = async () => { claims++; rewards = { ...rewards, checkingIn: true }; const result = await pending; rewards = { ...rewards, checkingIn: false, summary: result }; return result; };
  await render(); await act(async () => trigger().click());
  const claim = () => panel()!.querySelector<HTMLButtonElement>('button')!;
  await act(async () => claim().click()); await render();
  expect(panel()?.querySelector('strong')?.textContent).toBe('1杯');
  expect(claim().disabled).toBe(false); expect(claim().getAttribute('aria-busy')).not.toBe('true');
  expect(claim().textContent).toContain('签到领 1 杯');
  expect(claim().querySelector('[data-slot="button-content"]')).toBeNull();
  expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
  await act(async () => claim().click()); expect(claims).toBe(1);
  await act(async () => { complete({ ...summary(['2026-10-31', '2026-11-01']), awarded: true, reward: 1 }); await pending; }); await render();
  expect(panel()?.querySelector('strong')?.textContent).toBe('2杯');
  expect(claim().textContent).toContain('已领取'); expect(claim().getAttribute('aria-label')).toBe('今日已签到');
  expect(claim().getAttribute('aria-disabled')).toBe('true'); expect(claim().disabled).toBe(false);
  expect(panel()?.querySelector('[data-coffee-credit]')?.textContent).toContain('+1');
  await act(async () => claim().click()); expect(claims).toBe(1);
  await wait(700); expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
});

test('a previously claimed day has the receipt style without replaying an award', async () => {
  authenticate(); rewards = { ...rewards, summary: summary(['2026-10-31', '2026-11-01']) };
  await render(); await act(async () => trigger().click());
  const button = panel()!.querySelector<HTMLButtonElement>('button')!;
  expect(button.getAttribute('data-claimed')).toBe('true');
  expect(button.textContent).toContain('已领取');
  expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
  await act(async () => button.click()); expect(claims).toBe(0);
});

test('development preview repeats awards locally and can restore the real claimed day', async () => {
  const environment = process.env.NODE_ENV;
  const variables: Record<string, string | undefined> = process.env;
  variables.NODE_ENV = 'development';
  try {
    authenticate(); rewards = { ...rewards, summary: summary(['2026-10-31', '2026-11-01']) };
    await render(); await act(async () => trigger().click());
    expect(panel()?.textContent).toContain('动效预览 · 可重复领取');
    const collect = () => panel()!.querySelector<HTMLButtonElement>('[data-repeatable="true"]')!;
    expect(collect().textContent).toContain('签到领 1 杯');
    await act(async () => collect().click());
    expect(panel()?.querySelector('strong')?.textContent).toBe('3杯');
    expect(collect().getAttribute('aria-disabled')).toBeNull();
    expect(collect().textContent).toContain('已领取');
    await wait(700); await act(async () => collect().click());
    expect(panel()?.querySelector('strong')?.textContent).toBe('4杯');
    expect(panel()?.querySelector('[data-coffee-credit]')?.textContent).toContain('+1');
    expect(claims).toBe(0); expect(rewards.summary?.balance).toBe(2);
    await act(async () => panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    await act(async () => trigger().click());
    expect(panel()?.querySelector('strong')?.textContent).toBe('4杯');
    const endPreview = [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '结束预览')!;
    await act(async () => endPreview.click());
    expect(panel()?.querySelector('strong')?.textContent).toBe('2杯');
    expect(panel()?.querySelector('[data-repeatable="true"]')).toBeNull();
    expect(panel()?.querySelector<HTMLButtonElement>('button')?.getAttribute('aria-disabled')).toBe('true');
    expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
  } finally { if (environment === undefined) delete variables.NODE_ENV; else variables.NODE_ENV = environment; }
});

test('production cannot enable a repeatable check-in or preview controls', async () => {
  const environment = process.env.NODE_ENV;
  const variables: Record<string, string | undefined> = process.env;
  variables.NODE_ENV = 'production';
  try {
    authenticate(); rewards = { ...rewards, summary: summary(['2026-10-31', '2026-11-01']) };
    await render(); await act(async () => trigger().click());
    expect(panel()?.textContent).not.toContain('预览');
    expect(panel()?.querySelector('[data-repeatable="true"]')).toBeNull();
    await act(async () => panel()!.querySelector<HTMLButtonElement>('button')!.click());
    expect(claims).toBe(0);
  } finally { if (environment === undefined) delete variables.NODE_ENV; else variables.NODE_ENV = environment; }
});

test('a failed or idempotent claim never invents a credit animation', async () => {
  authenticate();
  rewards.checkIn = async () => { claims++; return undefined; };
  await render(); await act(async () => trigger().click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button')!.click());
  expect(panel()?.querySelector('strong')?.textContent).toBe('1杯');
  expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
  rewards.checkIn = async () => { const result = { ...summary(['2026-10-31', '2026-11-01']), awarded: false, reward: 1 as const }; rewards = { ...rewards, summary: result }; return result; };
  await render(); await act(async () => panel()!.querySelector<HTMLButtonElement>('button')!.click()); await render();
  expect(panel()?.querySelector<HTMLButtonElement>('button')?.getAttribute('data-claimed')).toBe('true');
  expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
});

test('closing during a claim cannot replay the delayed award when the panel reopens', async () => {
  authenticate();
  let complete!: (value: CoffeeCheckInResult) => void;
  const pending = new Promise<CoffeeCheckInResult>(resolve => { complete = resolve; });
  rewards.checkIn = () => pending;
  await render(); await act(async () => trigger().click());
  await act(async () => panel()!.querySelector<HTMLButtonElement>('button')!.click());
  await act(async () => panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  const result: CoffeeCheckInResult = { ...summary(['2026-10-31', '2026-11-01']), awarded: true, reward: 1 };
  await act(async () => { complete(result); await pending; });
  rewards = { ...rewards, summary: result }; await render();
  await act(async () => trigger().click());
  expect(panel()?.querySelector('[data-coffee-credit]')).toBeNull();
  expect(panel()?.querySelector<HTMLButtonElement>('button')?.getAttribute('data-claimed')).toBe('true');
});

test('changing accounts closes the popup and cancels a late hover opening', async () => {
  authenticate(); await render(); await act(async () => trigger().click());
  expect(panel()?.textContent).toContain('1杯');
  rewards = { ...rewards, accountId: 'account-b', principal: 'account-b:session', summary: undefined, loading: true };
  await render(); expect(panel()).toBeNull(); expect(trigger().textContent).not.toContain('1');
  await act(async () => trigger().dispatchEvent(new PointerEvent('pointerover', { pointerType: 'mouse', bubbles: true })));
  rewards = { ...rewards, accountId: null, principal: 'anonymous', identityStatus: 'anonymous', loading: false };
  await render(); await wait(150); expect(panel()).toBeNull();
});

test('failed balance loading offers retry and cannot claim an unknown day', async () => {
  authenticate(); rewards = { ...rewards, summary: undefined, error: new Error('Offline') };
  await render(); await act(async () => trigger().click());
  expect(panel()?.querySelector('strong')).toBeNull();
  expect(panel()?.querySelector('[role="alert"]')?.textContent).toContain('咖啡数据暂时无法加载');
  expect(panel()?.querySelector<HTMLButtonElement>('button')?.disabled).toBe(true);
  const retry = [...panel()!.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '重试')!;
  await act(async () => retry.click()); expect(retries).toBe(1); expect(claims).toBe(0);
});

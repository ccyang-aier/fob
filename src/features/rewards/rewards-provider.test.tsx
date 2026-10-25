import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, StrictMode, useEffect, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { coffeeSummaryFromDays } from '@fob/shared/rewards';
import type { CoffeeCheckInResult, CoffeeSummary } from '@fob/shared/rewards';
import type { IdentitySession } from '@/features/identity/session-store';
import type { useCoffeeRewards as ReadRewards } from './rewards-provider';

type Rewards = ReturnType<typeof ReadRewards>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(accept => { resolve = accept; });
  return { promise, resolve };
}
const alpha = 'c41a971f-f734-42ac-a99c-d6df1393a88a', beta = 'af90789e-459d-41e8-977a-ff59295c6b08';
const snapshot = (accountId: string, days: string[] = []): CoffeeSummary => ({ accountId, ...coffeeSummaryFromDays(days, new Date('2026-10-25T04:00:00Z')) });
const signedIn = (id: string): IdentitySession => ({ status: 'authenticated', user: { id, name: id, email: `${id}@test.invalid`, emailVerified: true }, expiresAt: '2026-12-01T00:00:00Z' });
let browser: Window, root: Root, session: IdentitySession, rewards: Rewards, renderProvider: () => ReactNode;
let summaries: { accountId: string; pending: ReturnType<typeof deferred<CoffeeSummary>> }[];
let claims: { accountId: string; pending: ReturnType<typeof deferred<CoffeeCheckInResult>> }[];
let signIns = 0, mounted = 0;
let notices: unknown[][];
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3001/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'localStorage']) globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-provider', () => ({ useIdentity: () => ({ session, openSignIn: () => { signIns++; }, refresh: async () => session }) }));
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (...args: unknown[]) => { notices.push(args); } }) }));
  mock.module('./rewards-api', () => ({ RewardsError: class extends Error {}, rewardsApi: {
    summary: (accountId: string) => { const pending = deferred<CoffeeSummary>(); summaries.push({ accountId, pending }); return pending.promise; },
    checkIn: (accountId: string) => { const pending = deferred<CoffeeCheckInResult>(); claims.push({ accountId, pending }); return pending.promise; },
  } }));
  const { RewardsProvider, useCoffeeRewards } = await import('./rewards-provider');
  const { RewardsCard } = await import('./rewards-card');
  function Capture() {
    const value = useCoffeeRewards();
    useEffect(() => { rewards = value; }, [value]);
    useEffect(() => { mounted++; }, []);
    return null;
  }
  renderProvider = () => <RewardsProvider><Capture /><RewardsCard /></RewardsProvider>;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => {
  await act(async () => root.render(null));
  session = { status: 'anonymous' }; summaries = []; claims = []; notices = []; signIns = 0; mounted = 0;
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render(strict = false) { await act(async () => root.render(strict ? <StrictMode>{renderProvider()}</StrictMode> : renderProvider())); }
async function settle() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
async function publish(value: CoffeeSummary, request = summaries.at(-1)!) { await act(async () => request.pending.resolve(value)); await settle(); }

test('anonymous accounts have no fabricated balance or API requests and check-in opens existing sign-in', async () => {
  await render();
  expect(rewards.summary).toBeUndefined(); expect(rewards.loading).toBe(false); expect(summaries).toHaveLength(0);
  await act(async () => rewards.checkIn()); expect(signIns).toBe(1); expect(claims).toHaveLength(0);
});

test('only confirmed server awards change the shared balance', async () => {
  session = signedIn(alpha); await render(); await publish(snapshot(alpha));
  expect(rewards.summary?.balance).toBe(0);
  let checking!: Promise<void>;
  await act(async () => { checking = rewards.checkIn(); });
  expect(claims).toHaveLength(1); expect(rewards.summary?.balance).toBe(0);
  await act(async () => { claims[0]!.pending.resolve({ ...snapshot(alpha, ['2026-10-25']), awarded: true, reward: 1 }); await checking; });
  await settle();
  expect(rewards.summary?.balance).toBe(1); expect(rewards.summary?.checkedInToday).toBe(true); expect(notices).toHaveLength(1);
  await act(async () => rewards.checkIn()); expect(claims).toHaveLength(1);
});

test('the daily card waits for confirmation, disappears after check-in and returns on the next server day', async () => {
  session = signedIn(alpha); await render();
  expect(document.querySelector('section[aria-label="每日签到"]')).toBeNull();
  await publish(snapshot(alpha));
  const button = document.querySelector('section[aria-label="每日签到"] > button') as HTMLButtonElement;
  expect(button.textContent).toContain('签到领 1 杯');
  await act(async () => button.click());
  await settle();
  expect(claims).toHaveLength(1);
  expect(document.querySelector('section[aria-label="每日签到"]')).not.toBeNull();
  expect(button.disabled).toBe(true);
  await act(async () => claims[0]!.pending.resolve({ ...snapshot(alpha, ['2026-10-25']), awarded: true, reward: 1 }));
  await settle();
  expect(document.querySelector('section[aria-label="每日签到"]')).toBeNull();
  await act(async () => rewards.refresh());
  await publish({ accountId: alpha, ...coffeeSummaryFromDays(['2026-10-25'], new Date('2026-10-26T04:00:00Z')) });
  expect(document.querySelector('section[aria-label="每日签到"]')).not.toBeNull();
  expect(rewards.summary?.balance).toBe(1);
});

test('a completed card stays hidden after reload and does not hide another account’s daily opportunity', async () => {
  session = signedIn(alpha); await render(); await publish(snapshot(alpha, ['2026-10-25']));
  expect(document.querySelector('section[aria-label="每日签到"]')).toBeNull();
  session = signedIn(beta); await render();
  expect(document.querySelector('section[aria-label="每日签到"]')).toBeNull();
  await publish(snapshot(beta));
  expect(document.querySelector('section[aria-label="每日签到"] > button')?.textContent).toContain('签到领 1 杯');
});

test('switching accounts fences a late query and preserves the mounted workspace', async () => {
  session = signedIn(alpha); await render(); const old = summaries[0]!;
  session = signedIn(beta); await render();
  expect(rewards.summary).toBeUndefined(); expect(mounted).toBe(1);
  await publish(snapshot(alpha, ['2026-10-25']), old);
  expect(rewards.accountId).toBe(beta); expect(rewards.summary).toBeUndefined();
  await publish(snapshot(beta)); expect(rewards.summary?.accountId).toBe(beta); expect(rewards.summary?.balance).toBe(0);
  let checking!: Promise<void>;
  await act(async () => { checking = rewards.checkIn(); });
  expect(claims.at(-1)?.accountId).toBe(beta);
  await act(async () => { claims.at(-1)!.pending.resolve({ ...snapshot(beta, ['2026-10-25']), awarded: true, reward: 1 }); await checking; });
  await settle(); expect(rewards.summary?.balance).toBe(1); expect(rewards.summary?.accountId).toBe(beta);
});

test('an in-flight check-in cannot republish a signed-out account or emit a stale success', async () => {
  session = signedIn(alpha); await render(); await publish(snapshot(alpha));
  let checking!: Promise<void>;
  await act(async () => { checking = rewards.checkIn(); });
  session = { status: 'anonymous' }; await render();
  await act(async () => { claims[0]!.pending.resolve({ ...snapshot(alpha, ['2026-10-25']), awarded: true, reward: 1 }); await checking; });
  await settle();
  expect(rewards.summary).toBeUndefined(); expect(rewards.accountId).toBeNull(); expect(notices).toHaveLength(0);
});

test('StrictMode setup/cleanup/setup still accepts the active account award', async () => {
  session = signedIn(alpha); await render(true);
  await publish(snapshot(alpha));
  let checking!: Promise<void>;
  await act(async () => { checking = rewards.checkIn(); });
  await act(async () => { claims[0]!.pending.resolve({ ...snapshot(alpha, ['2026-10-25']), awarded: true, reward: 1 }); await checking; });
  await settle();
  expect(rewards.summary?.balance).toBe(1); expect(notices).toHaveLength(1);
});

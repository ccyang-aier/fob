import { expect, test } from 'bun:test';
import { coffeeSummaryFromDays } from '@fob/shared/rewards';
import { createRewardsApi } from './rewards-api';

const accountId = 'c41a971f-f734-42ac-a99c-d6df1393a88a';
const otherAccount = 'af90789e-459d-41e8-977a-ff59295c6b08';
const summary = { accountId, ...coffeeSummaryFromDays(['2026-10-25'], new Date('2026-10-25T12:00:00Z')) };

test('check-in uses verified cookies and an empty JSON body, with no client amount or account scope', async () => {
  let captured: { url: string; init?: RequestInit } | undefined;
  const api = createRewardsApi({ origin: async () => 'https://api.fob.test', fetchImpl: (async (url, init) => {
    captured = { url: String(url), init };
    return Response.json({ ...summary, awarded: false, reward: 1 });
  }) as typeof fetch });
  expect(await api.checkIn(accountId)).toMatchObject({ balance: 1, awarded: false });
  expect(captured).toMatchObject({ url: 'https://api.fob.test/api/rewards/coffee/check-in', init: { method: 'POST', credentials: 'include', cache: 'no-store', body: '{}' } });
});

test('responses from another cookie account never become the displayed account balance', async () => {
  const api = createRewardsApi({ origin: async () => 'https://api.fob.test', fetchImpl: (async () => Response.json({ ...summary, accountId: otherAccount })) as typeof fetch });
  await expect(api.summary(accountId)).rejects.toMatchObject({ code: 'ACCOUNT_CHANGED' });
});

test('malformed balances and unavailable authentication fail explicitly instead of becoming a fake zero', async () => {
  const invalid = createRewardsApi({ origin: async () => 'https://api.fob.test', fetchImpl: (async () => Response.json({ ...summary, balance: -1 })) as typeof fetch });
  await expect(invalid.summary(accountId)).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  const expired = createRewardsApi({ origin: async () => 'https://api.fob.test', fetchImpl: (async () => new Response('{}', { status: 401 })) as typeof fetch });
  await expect(expired.summary(accountId)).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
});

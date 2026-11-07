import { expect, test } from 'bun:test';
import { KnowledgeDataError } from '../data/errors';
import { downloadAssetWithRetry } from './download-with-retry';

const grant = { url: 'https://storage.example/image.png', method: 'GET' as const, expiresAt: '2099-01-01T00:00:00Z' };

test('new document media waits for the authorized persisted reference without changing scope', async () => {
  const controller = new AbortController();
  const attempts: string[] = [], delays: number[] = [];
  expect(await downloadAssetWithRetry('library', 'hash', controller.signal, {
    download: async (base, hash, signal) => {
      attempts.push(`${base}:${hash}`); expect(signal).toBe(controller.signal);
      if (attempts.length < 3) throw new KnowledgeDataError('FORBIDDEN');
      return grant;
    },
    wait: async ms => { delays.push(ms); },
  })).toEqual(grant);
  expect(attempts).toEqual(['library:hash', 'library:hash', 'library:hash']);
  expect(delays).toEqual([250, 500]);
});

test('persistent ACL denial has a finite retry budget and still rejects', async () => {
  let attempts = 0;
  const delays: number[] = [];
  await expect(downloadAssetWithRetry('library', 'hash', new AbortController().signal, {
    download: async () => { attempts++; throw new KnowledgeDataError('FORBIDDEN'); },
    wait: async ms => { delays.push(ms); },
  })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(attempts).toBe(7);
  expect(delays.reduce((sum, ms) => sum + ms, 0)).toBe(11_750);
});

for (const code of ['UNAUTHENTICATED', 'INVALID_REQUEST', 'ENDPOINT'] as const) test(`${code} stops immediately`, async () => {
  let attempts = 0, waits = 0;
  await expect(downloadAssetWithRetry('library', 'hash', new AbortController().signal, {
    download: async () => { attempts++; throw new KnowledgeDataError(code); },
    wait: async () => { waits++; },
  })).rejects.toMatchObject({ code });
  expect(attempts).toBe(1); expect(waits).toBe(0);
});

test('switching away aborts pending retries before another request starts', async () => {
  let attempts = 0;
  const controller = new AbortController();
  await expect(downloadAssetWithRetry('library', 'hash', controller.signal, {
    download: async () => { attempts++; throw new KnowledgeDataError('FORBIDDEN'); },
    wait: async () => { controller.abort(); },
  })).rejects.toMatchObject({ name: 'AbortError' });
  expect(attempts).toBe(1);
});

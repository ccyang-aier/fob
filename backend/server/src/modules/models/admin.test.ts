import { describe, expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { importModelCatalog, readBundledModelCatalog, validateModelCatalog } from './admin';

describe('model catalog import boundary', () => {
  test('bundled model metadata has verified official sources and unique real IDs', async () => {
    const catalog = await readBundledModelCatalog();
    expect(catalog.items.length).toBeGreaterThan(0);
    expect(new Set(catalog.items.map((item) => item.id)).size).toBe(catalog.items.length);
    for (const item of catalog.items) expect(item.sources.every((source) => new URL(source.url).protocol === 'https:')).toBe(true);
  });

  test('rejects invalid, duplicate, or execution-bearing payloads before database access', async () => {
    const entry = (await readBundledModelCatalog()).items[0]!;
    let connected = false;
    const admin = { connect: async () => { connected = true; throw new Error('Must not acquire a connection'); } } as unknown as Pool;
    for (const value of [
      { items: [entry, entry] },
      { items: [{ ...entry, maxOutput: -1 }] },
      { items: [{ ...entry, ratings: { ...entry.ratings, intelligence: { ...entry.ratings.intelligence, score: 101 } } }] },
      ...(['intelligence', 'writing', 'design', 'speed', 'price', 'agentic'] as const)
        .map(axis => ({ items: [{ ...entry, ratings: { ...entry.ratings, [axis]: null } }] })),
      { items: [{ ...entry, ratings: { ...entry.ratings, intelligence: { ...entry.ratings.intelligence, source: null } } }] },
      { items: [{ ...entry, ratings: { ...entry.ratings, writing: {
        kind: 'mock', score: 60, source: entry.sources[0], note: { zh: 'Mock', en: 'Mock' },
      } } }] },
      { items: [{ ...entry, ratings: { ...entry.ratings, writing: {
        kind: 'mock', score: 60, source: null, note: { zh: '人工评分', en: 'An actual score' },
      } } }] },
      { items: [{ ...entry, reasoning: { levels: ['low', 'low'], defaultLevel: 'low' } }] },
      { items: [{ ...entry, reasoning: { levels: ['low', 'high'], defaultLevel: 'medium' } }] },
      { items: [{ ...entry, capabilities: { ...entry.capabilities, reasoning: false } }] },
      { items: [{ ...entry, benchmarks: [] }] },
      { items: [{ ...entry, apiKey: 'provider-secret' }] },
      { items: [{ ...entry, sources: [{ label: 'Unsafe URL', url: 'http://example.com' }] }] },
      { items: [entry], accountId: 'invented-scope' },
    ]) await expect(importModelCatalog(admin, value)).rejects.toMatchObject({ code: 'invalid_config' });
    expect(connected).toBe(false);
    expect(validateModelCatalog({ items: [] })).toEqual({ items: [] });
  });

  test('null exclusively represents unsupported Agentic tools; mock scores remain explicit and unattributed', async () => {
    const catalog = await readBundledModelCatalog();
    const unsupported = catalog.items.find(item => item.id === 'gemini-3.1-flash-image')!;
    expect(unsupported.capabilities.tools).toBe(false);
    expect(unsupported.ratings.agentic).toBeNull();
    expect(() => validateModelCatalog({ items: [{ ...unsupported, capabilities: { ...unsupported.capabilities, tools: null } }] })).toThrow();
    expect(() => validateModelCatalog({ items: [{ ...unsupported, ratings: { ...unsupported.ratings, agentic: unsupported.ratings.intelligence } }] })).toThrow();
    for (const item of catalog.items) {
      for (const [axis, value] of Object.entries(item.ratings)) {
        if (axis !== 'agentic' || item.capabilities.tools !== false) expect(value).not.toBeNull();
        if (value?.kind === 'mock') {
          expect(value.source).toBeNull();
          expect(value.note.zh).toMatch(/mock/i);
          expect(value.note.en).toMatch(/mock/i);
        } else if (value) expect(value.source).not.toBeNull();
      }
    }
  });
});

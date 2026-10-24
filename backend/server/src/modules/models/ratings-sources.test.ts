import { describe, expect, test } from 'bun:test';
import { readBundledModelCatalog } from './admin';
import { mergeRatingEvidence, preferenceRating, priceRating, readAnalysisApiRatings, readAnalysisRatings, readDesignRatings, readImageRatings, readPageObjects, readWritingRatings } from './ratings-sources';

const observedAt = '2026-10-17';
function page(value: unknown) {
  return `<script>self.__next_f.push([1,${JSON.stringify(`0:${JSON.stringify(value)}\n`)}])</script>`;
}

describe('sourced six-dimensional model ratings', () => {
  test('only parses JSON data without executing downloaded JavaScript', () => {
    const html = page({ slug: 'actual-data' }) + '<script>throw new Error("Do not execute");</script>';
    expect(readPageObjects(html)).toEqual([{ slug: 'actual-data' }]);
  });

  test('keeps missing and estimated data missing, including Agentic rather than borrowing a coding score', () => {
    const ratings = readAnalysisRatings(page({
      slug: 'example', name: 'Example (High)', intelligenceIndex: 52.2,
      intelligenceIndexIsEstimated: false, analystAgent: null, medianOutputTokensPerSecond: 100,
      codingIndex: 99,
    }), observedAt).get('example')!;
    expect(ratings.intelligence?.score).toBe(52.2);
    expect(ratings.agentic).toBeNull();
    expect(ratings.speed?.score).toBe(50);
    expect(ratings.intelligence?.note.en).toContain('Example (High)');
    const estimated = readAnalysisRatings(page({
      slug: 'estimated', name: 'Estimated', intelligenceIndex: 80,
      intelligenceIndexIsEstimated: true, analystAgent: 0.625, medianOutputTokensPerSecond: null,
    }), observedAt).get('estimated')!;
    expect(estimated.intelligence).toBeNull();
    expect(estimated.agentic?.score).toBe(62.5);
    expect(estimated.speed).toBeNull();
    expect(() => readAnalysisRatings('<html>blocked</html>', observedAt)).toThrow();
  });

  test('official API imports its two supported dimensions and rejects invalid source data', () => {
    const item = { slug: 'example', name: 'Example', evaluations: { artificial_analysis_intelligence_index: 50 }, median_output_tokens_per_second: 300 };
    const value = readAnalysisApiRatings({ data: [item] }, observedAt).get('example')!;
    expect(value.intelligence?.score).toBe(50);
    expect(value.speed?.score).toBe(75);
    expect('agentic' in value).toBe(false);
    expect(() => readAnalysisApiRatings({ data: [{ ...item, median_output_tokens_per_second: -1 }] }, observedAt)).toThrow();
  });

  test('uses only the frontend preference board and a fixed reference for independent Elo scales', () => {
    const values = readDesignRatings(page({ initialBoards: {
      allcategories: { modelStats: [{ model: 'actual', elo: 1200 }] },
      fullstack: { modelStats: [{ model: 'actual', elo: 2000 }] },
    } }), observedAt);
    expect(values.get('actual')?.score).toBe(50);
    expect(preferenceRating(1600)).toBe(90.9);
    expect(() => preferenceRating(Number.NaN)).toThrow();
  });

  test('retains creative-writing tested model identity and does not mistake confidence intervals for scores', () => {
    const values = readWritingRatings('<table><tr><td>1</td><td>1–3</td><td><a>example-high</a>Lab</td><td>1400±15</td><td>1,000</td></tr></table>', observedAt);
    expect(values.get('example-high')?.score).toBe(76);
    expect(values.get('example-high')?.note.en).toContain('example-high');
    expect(() => readWritingRatings('<html>Challenge</html>', observedAt)).toThrow();
  });

  test('prices compare the same text-token workload and exclude image generation costs', async () => {
    const model = (await readBundledModelCatalog()).items.find(item => item.id === 'gpt-6.1-sol')!;
    expect(priceRating(model, observedAt)?.score).toBe(20);
    expect(priceRating({ ...model, pricing: { ...model.pricing, input: null } }, observedAt)).toBeNull();
    expect(priceRating({ ...model, capabilities: { ...model.capabilities, imageGeneration: true } }, observedAt)).toBeNull();
  });

  test('image measurements preserve their own modality, host, units and normalization', () => {
    const ratings = readImageRatings(page({
      model: { slug: 'nano-banana-2', qualityElo: 1138.52 }, host: { name: 'Google' },
      isRepresentative: true, pricePer1kImages: 67, performance: { medianGenerationTimeSeconds: 8.5014 },
    }), observedAt).get('nano-banana-2')!;
    expect(ratings.design?.kind).toBe('measured');
    expect(ratings.design?.score).toBe(41.2);
    expect(ratings.speed?.score).toBe(54);
    expect(ratings.price?.score).toBe(42.7);
    expect(ratings.speed?.note.en).toContain('seconds/image');
    expect(ratings.price?.note.en).toContain('1000 images');
    expect('intelligence' in ratings).toBe(false);
    expect('writing' in ratings).toBe(false);
    expect('agentic' in ratings).toBe(false);
  });

  test('measured data replaces mocks; missing observations and later mocks cannot erase measured scores', async () => {
    const model = structuredClone((await readBundledModelCatalog()).items.find(item => item.id === 'claude-haiku-5-5')!);
    const mock = structuredClone(model.ratings.writing);
    expect(mock.kind).toBe('mock');
    const measured = model.ratings.design;
    mergeRatingEvidence(model, { writing: measured });
    expect(model.ratings.writing).toEqual(measured);
    mergeRatingEvidence(model, { writing: null, intelligence: null, design: undefined });
    expect(model.ratings.writing).toEqual(measured);
    expect(model.ratings.intelligence).not.toBeNull();
    mergeRatingEvidence(model, { writing: mock });
    expect(model.ratings.writing).toEqual(measured);
    const unsupported = structuredClone((await readBundledModelCatalog()).items.find(item => item.id === 'gemini-3.1-flash-image')!);
    mergeRatingEvidence(unsupported, { agentic: measured });
    expect(unsupported.ratings.agentic).toBeNull();
  });
});

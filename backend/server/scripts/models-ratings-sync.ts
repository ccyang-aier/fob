import { writeFile } from 'node:fs/promises';
import { readBundledModelCatalog, validateModelCatalog } from '../src/modules/models/admin';
import { mergeRatingEvidence, priceRating, ratingIdentities, readAnalysisApiRatings, readAnalysisRatings, readDesignRatings, readImageRatings, readWritingRatings } from '../src/modules/models/ratings-sources';

// Administrative snapshot refresh only. The public API never fetches external sites or exposes keys.
const observedAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const catalog = await readBundledModelCatalog();
async function page(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}
const endpoints = [
  ['Artificial Analysis', 'https://artificialanalysis.ai/leaderboards/models', readAnalysisRatings],
  ['DesignArena', 'https://www.designarena.ai/leaderboard', readDesignRatings],
  ['Arena writing', 'https://arena.ai/leaderboard/chat/text/creative-writing', readWritingRatings],
  ['Artificial Analysis image', 'https://artificialanalysis.ai/image/models/nano-banana-2', readImageRatings],
] as const;
const results = await Promise.allSettled(endpoints.map(async ([, url, parse]) => parse(await page(url), observedAt)));
const [analysis, design, writing, image] = results.map((result, index) => {
  if (result.status === 'fulfilled') return result.value;
  console.warn(`${endpoints[index]![0]} unavailable (${result.reason instanceof Error ? result.reason.message : 'unknown error'}); retain its last sourced snapshot.`);
  return null;
}) as [ReturnType<typeof readAnalysisRatings> | null, ReturnType<typeof readDesignRatings> | null, ReturnType<typeof readWritingRatings> | null, ReturnType<typeof readImageRatings> | null];
let api: ReturnType<typeof readAnalysisApiRatings> | null = null;
if (process.env.ARTIFICIAL_ANALYSIS_API_KEY) {
  // Official API: 1000 requests/day, attribution required; keep the key in the administrative environment.
  const response = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', {
    headers: { 'x-api-key': process.env.ARTIFICIAL_ANALYSIS_API_KEY }, signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Artificial Analysis API returned HTTP ${response.status}; catalog file was not changed.`);
  api = readAnalysisApiRatings(await response.json(), observedAt);
} else console.log('Official Artificial Analysis API requires ARTIFICIAL_ANALYSIS_API_KEY; public page snapshot used.');
if (!analysis && !api && !design && !writing && !image) throw new Error('No rating source could be refreshed; catalog file was not changed.');
for (const item of catalog.items) {
  const identity = ratingIdentities[item.id];
  if (analysis && identity) mergeRatingEvidence(item, analysis.get(identity.analysis) ?? {});
  if (api && identity) mergeRatingEvidence(item, api.get(identity.analysis) ?? {});
  if (design && identity?.design) mergeRatingEvidence(item, { design: design.get(identity.design) });
  if (writing && identity?.writing) mergeRatingEvidence(item, { writing: writing.get(identity.writing) });
  mergeRatingEvidence(item, { price: priceRating(item, observedAt) });
  if (item.id === 'gemini-3.1-flash-image' && image) mergeRatingEvidence(item, image.get('nano-banana-2') ?? {});
}
validateModelCatalog(catalog);
await writeFile(new URL('../src/modules/models/catalog-data.json', import.meta.url), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(JSON.stringify({ models: catalog.items.length, observedAt, refreshed: [
  ...results.flatMap((result, index) => result.status === 'fulfilled' ? [endpoints[index]![0]] : []),
  ...(api ? ['Artificial Analysis API'] : []),
] }));

import { expect, test } from 'bun:test';
import { profileMedalCatalog,profileMedalFamilies,profileMedalIdSchema,type ProfileActivity } from '@fob/shared/knowledge/contracts';
import { localMedalProgress,localProfileMedals } from './profile-medals';

const event = (at: string): ProfileActivity => ({ id: at,kind: 'created',at,targetId: at,targetKind: 'document',title: '',excerpt: null });
test('medal times come from actual first document and seventh consecutive Shanghai day, even after the streak ends',() => {
  const events = Array.from({ length: 7 },(_,index) => event(`2026-10-${String(index+1).padStart(2,'0')}T01:02:03Z`));
  const data = localProfileMedals([events[6],...events.slice(0,6),event('2026-10-02T02:00:00Z')]);
  expect(data).toEqual([{ id:'gardener',earnedAt:events[0].at },{ id:'creator',earnedAt:events[6].at }]);
  expect(localProfileMedals(events.filter((_,index) => index!==3))).toEqual([{ id:'gardener',earnedAt:events[0].at }]);
  expect(localProfileMedals([])).toEqual([]);
});

test('the canonical collection has eighteen unique stable medals in six ascending three-tier families',() => {
  expect(profileMedalCatalog).toHaveLength(18);
  expect(new Set(profileMedalCatalog.map(medal => medal.id)).size).toBe(18);
  for (const family of profileMedalFamilies) {
    const medals=profileMedalCatalog.filter(medal => medal.family===family);
    expect(medals.map(medal => medal.tier)).toEqual([1,2,3]);
    expect(medals[0].target).toBeLessThan(medals[1].target);
    expect(medals[1].target).toBeLessThan(medals[2].target);
    for (const medal of medals) expect(profileMedalIdSchema.parse(medal.id)).toBe(medal.id);
  }
});

test('local tier thresholds use actual chronological events and never manufacture social progress',() => {
  const events=Array.from({ length:100 },(_,index) => event(new Date(Date.UTC(2022,0,index+1,1)).toISOString()));
  const awards=localProfileMedals(events.toReversed());
  for (const medal of profileMedalCatalog.filter(medal => medal.family==='creation' || medal.family==='streak')) expect(awards.find(award => award.id===medal.id)?.earnedAt).toBe(events[medal.target-1].at);
  expect(awards).toHaveLength(6);
  expect(awards.map(award => award.earnedAt)).toEqual(awards.map(award => award.earnedAt).toSorted());
  const progress=localMedalProgress(events);
  expect(progress).toHaveLength(18);
  expect(progress.filter(item => profileMedalCatalog.find(medal => medal.id===item.id)?.family==='creation').every(item => item.value===100)).toBe(true);
  expect(progress.filter(item => profileMedalCatalog.find(medal => medal.id===item.id)?.family==='streak').every(item => item.value===100)).toBe(true);
  expect(progress.filter(item => !['creation','streak'].includes(profileMedalCatalog.find(medal => medal.id===item.id)!.family)).every(item => item.value===0)).toBe(true);
});

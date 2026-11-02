import { expect, test } from 'bun:test';
import type { ProfileActivity } from '@fob/shared/knowledge/contracts';
import { localProfileMedals } from './profile-medals';

const event = (at: string): ProfileActivity => ({ id: at,kind: 'created',at,targetId: at,targetKind: 'document',title: '',excerpt: null });
test('medal times come from actual first document and seventh consecutive Shanghai day, even after the streak ends',() => {
  const events = Array.from({ length: 7 },(_,index) => event(`2026-10-${String(index+1).padStart(2,'0')}T01:02:03Z`));
  const data = localProfileMedals([events[6],...events.slice(0,6),event('2026-10-02T02:00:00Z')]);
  expect(data).toEqual([{ id:'gardener',earnedAt:events[0].at },{ id:'creator',earnedAt:events[6].at }]);
  expect(localProfileMedals(events.filter((_,index) => index!==3))).toEqual([{ id:'gardener',earnedAt:events[0].at }]);
  expect(localProfileMedals([])).toEqual([]);
});

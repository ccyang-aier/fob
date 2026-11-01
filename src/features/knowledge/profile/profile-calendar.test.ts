import { expect, test } from 'bun:test';
import { activityStreak, calendarDays, localPersonalProfile, profileDay } from './profile-calendar';
import type { LocalLibrary } from '../local/local-library';

test('calendar aligns real weeks across month/year boundaries without future clickable days', () => {
  for (const today of ['2026-11-01','2027-01-01','2028-03-01']) {
    const days = calendarDays(today,new Map([[today,4]]));
    expect(days).toHaveLength(53 * 7);
    expect(days.filter(day => !day.outside && !day.future)).toHaveLength(365);
    expect(days.length % 7).toBe(0);
    expect(new Date(`${days[0].date}T12:00:00Z`).getUTCDay()).toBe(0);
    expect(days.filter(day => !day.future).at(-1)?.date).toBe(today);
    expect(days.find(day => day.date === today)?.count).toBe(4);
    expect(new Set(days.map(day => day.date)).size).toBe(days.length);
  }
  expect(profileDay('2026-10-31T16:01:00Z')).toBe('2026-11-01');
  expect(profileDay('2026-10-31T15:59:00Z')).toBe('2026-10-31');
});

test('the full-year calendar preserves real counts and excludes padding and future days', () => {
  const counts = new Map([['2026-01-01',5],['2026-10-31',2],['2026-11-01',3],['2026-11-02',90]]);
  const year = calendarDays('2026-11-01',counts);
  expect(year.reduce((sum,day) => sum+day.count,0)).toBe(10);
  expect(year.find(day => day.date === '2026-11-02')?.count).toBe(0);
  expect(year.at(-7)?.date).toBe('2026-11-01');
});

test('streak accepts an unfinished current day but ends on an actual missing day', () => {
  const calendar = ['2026-10-28','2026-10-30','2026-10-31'].map(date => ({ date,count: 1 }));
  expect(activityStreak(calendar,'2026-11-01')).toBe(2);
  expect(activityStreak(calendar,'2026-11-02')).toBe(0);
  expect(activityStreak([...calendar,{ date: '2026-11-01',count: 3 }],'2026-11-01')).toBe(3);
});

test('local profile preserves knowledge-base boundaries, truthful timestamps and complete daily counts when paginated', () => {
  const documents: LocalLibrary['documents'] = Array.from({ length: 45 },(_,index) => ({ id: `own-${index}`,baseId: 'own',folderId: 'folder',title: `Document ${index}`,body: { type: 'doc' },createdAt: '2026-11-01T01:00:00Z',updatedAt: '2026-11-01T01:00:00Z',starred: index === 0,deleted: false,draft: false }));
  const library: LocalLibrary = { bases: [],tags: [],folders: [{ id: 'folder',knowledgeBaseId: 'own',name: 'Personal folder' }],documents: [...documents,{ ...documents[0],id: 'foreign',baseId: 'other' },{ ...documents[0],id: 'deleted',deleted: true },{ ...documents[0],id: 'legacy',createdAt: undefined }] };
  const data = localPersonalProfile(library,'own',undefined,40,40,'2026-11-01');
  expect(data.documentTotal).toBe(46);
  expect(data.documents).toHaveLength(40);
  expect(data.activities).toHaveLength(40);
  expect(data.dayCounts.created).toBe(45);
  expect(data.calendar).toEqual([{ date: '2026-11-01',count: 45 }]);
  expect(data.saved).toHaveLength(2);
  expect(data.activities.every(event => event.targetId.startsWith('own-'))).toBe(true);
  expect(localPersonalProfile(library,'own','2026-10-31',80,80,'2026-11-01').activities).toEqual([]);
  expect(localPersonalProfile(library,'own',undefined,80,80,'2026-11-01').nextDocumentOffset).toBeNull();
});

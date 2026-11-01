import type { PersonalProfile, ProfileActivity, ProfileResource } from '@fob/shared/knowledge/contracts';
import type { LocalLibrary } from '../local/local-library';

export const profileTimeZone = 'Asia/Shanghai';
export const profileDay = (date: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: profileTimeZone }).format(new Date(date));

/** Calendar arithmetic uses UTC noon so host time zone and DST cannot shift a day. */
export function calendarDays(today: string, counts: ReadonlyMap<string, number>) {
  const end = new Date(`${today}T12:00:00Z`);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const firstDate = start.toISOString().slice(0,10);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const days: { date: string; count: number; future: boolean; outside: boolean }[] = [];
  const cursor = new Date(start);
  do {
    const date = cursor.toISOString().slice(0, 10);
    const outside = date < firstDate;
    days.push({ date, count: outside || date > today ? 0 : counts.get(date) ?? 0, future: date > today, outside });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  } while (cursor <= end || days.length % 7 !== 0);
  return days;
}

export function activityStreak(calendar: readonly Pick<PersonalProfile['calendar'][number], 'date' | 'count'>[], today: string) {
  const days = new Set(calendar.filter(day => day.count > 0).map(day => day.date));
  const cursor = new Date(`${today}T12:00:00Z`);
  if (!days.has(today)) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(cursor.toISOString().slice(0, 10))) { streak++; cursor.setUTCDate(cursor.getUTCDate() - 1); }
  return streak;
}

export function localPersonalProfile(library: LocalLibrary, knowledgeBaseId: string, day?: string, documentLimit = 40, activityLimit = 40, today = profileDay(new Date()), filter?: { q: string; sort: 'recent' | 'name' }): PersonalProfile {
  const docs = library.documents.filter(doc => doc.baseId === knowledgeBaseId && !doc.deleted);
  const documents = docs.map<ProfileResource>(doc => ({ id: doc.id, title: doc.title, kind: 'document', icon: doc.icon ?? null, createdAt: doc.createdAt ?? null, updatedAt: doc.updatedAt, count: doc.readCount ?? 0, starred: doc.starred, subscribed: false })).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt));
  const folders: ProfileResource[] = library.folders.filter(folder => folder.knowledgeBaseId === knowledgeBaseId).map(folder => ({ id: folder.id, title: folder.name, kind: 'folder', icon: folder.metadata?.icon ?? null, createdAt: null, updatedAt: docs.filter(doc => doc.folderId === folder.id).map(doc => doc.updatedAt).sort().at(-1) ?? `${today}T00:00:00+08:00`, count: docs.filter(doc => doc.folderId === folder.id).length, starred: false, subscribed: false }));
  const events: ProfileActivity[] = docs.flatMap(doc => doc.createdAt ? [{ id: `created:${doc.id}`, kind: 'created' as const, at: doc.createdAt, targetId: doc.id, targetKind: 'document' as const, title: doc.title, excerpt: null }] : []).sort((a,b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  const counts = new Map<string, number>();
  const start = new Date(`${today}T12:00:00Z`); start.setUTCDate(start.getUTCDate() - 364);
  const firstDay = start.toISOString().slice(0,10);
  for (const event of events) { const date = profileDay(event.at); if (date >= firstDay && date <= today) counts.set(date, (counts.get(date) ?? 0) + 1); }
  const filtered = day ? events.filter(event => profileDay(event.at) === day) : events;
  const matchingDocuments = documents.filter(doc => doc.title.toLocaleLowerCase().includes(filter?.q.trim().toLocaleLowerCase() ?? '')).toSorted((a,b) => filter?.sort === 'name' ? a.title.localeCompare(b.title) : b.updatedAt.localeCompare(a.updatedAt));
  return { documents: matchingDocuments.slice(0, documentLimit), documentTotal: documents.length, nextDocumentOffset: documentLimit<matchingDocuments.length ? documentLimit : null, folders, saved: documents.filter(doc => doc.starred), calendar: [...counts].map(([date,count]) => ({ date, count, counts: { created: count, commented: 0, liked: 0, subscribed: 0 } })), activities: filtered.slice(0, activityLimit), nextActivityOffset: activityLimit<filtered.length ? activityLimit : null, receivedLikes: 0, sharedDocuments: 0, dayCounts: { created: events.filter(event => profileDay(event.at) === (day ?? today)).length, commented: 0 } };
}

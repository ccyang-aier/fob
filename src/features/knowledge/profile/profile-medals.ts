import { profileMedalCatalog,type ProfileActivity,type ProfileMedalAward } from '@fob/shared/knowledge/contracts';
import { profileDay } from './profile-time';

export { profileMedalIds } from '@fob/shared/knowledge/contracts';

/** Local knowledge has one browser owner; no network members or sharing awards are invented. */
export function localProfileMedals(events: readonly ProfileActivity[]): ProfileMedalAward[] {
  const ordered = events.toSorted((a,b) => a.at.localeCompare(b.at));
  const documents = ordered.filter(event => event.kind==='created');
  const medals: ProfileMedalAward[] = profileMedalCatalog.filter(medal => medal.family==='creation').flatMap(medal => {
    const event=documents[medal.target-1]; return event ? [{ id:medal.id,earnedAt:event.at }] : [];
  });
  let previous = '', length = 0;
  for (const event of ordered) {
    const day = profileDay(event.at);
    if (day===previous) continue;
    length = previous && Date.parse(day)-Date.parse(previous)===86_400_000 ? length+1 : 1;
    previous = day;
    for (const medal of profileMedalCatalog.filter(medal => medal.family==='streak')) {
      if (length===medal.target && !medals.some(award => award.id===medal.id)) medals.push({ id:medal.id,earnedAt:event.at });
    }
  }
  return medals.toSorted((a,b) => a.earnedAt.localeCompare(b.earnedAt) || a.id.localeCompare(b.id));
}

export function localMedalProgress(events:readonly ProfileActivity[]) {
  const ordered=events.toSorted((a,b) => a.at.localeCompare(b.at));
  let previous='',length=0,longest=0;
  for (const event of ordered) {
    const day=profileDay(event.at); if (day===previous) continue;
    length=previous && Date.parse(day)-Date.parse(previous)===86_400_000 ? length+1 : 1;
    previous=day;longest=Math.max(longest,length);
  }
  return profileMedalCatalog.map(medal => ({ id:medal.id,target:medal.target,value:medal.family==='creation' ? ordered.filter(event => event.kind==='created').length : medal.family==='streak' ? longest : 0 }));
}

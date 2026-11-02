import type { ProfileActivity, ProfileMedalAward, ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { profileDay } from './profile-time';

export const profileMedalIds: readonly ProfileMedalId[] = ['gardener','creator','sharing'];

/** Local knowledge has one browser owner; no network members or sharing awards are invented. */
export function localProfileMedals(events: readonly ProfileActivity[]): ProfileMedalAward[] {
  const ordered = events.toSorted((a,b) => a.at.localeCompare(b.at));
  const first = ordered.find(event => event.kind==='created');
  const medals: ProfileMedalAward[] = first ? [{ id: 'gardener',earnedAt: first.at }] : [];
  let previous = '', length = 0;
  for (const event of ordered) {
    const day = profileDay(event.at);
    if (day===previous) continue;
    length = previous && Date.parse(day)-Date.parse(previous)===86_400_000 ? length+1 : 1;
    previous = day;
    if (length===7) { medals.push({ id: 'creator',earnedAt: event.at }); break; }
  }
  return medals;
}

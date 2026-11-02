import { profileMedalCatalog,type ProfileMedalId } from '@fob/shared/knowledge/contracts';
import Image from 'next/image';
import styles from './medal-wall.module.css';

export const medalById=Object.fromEntries(profileMedalCatalog.map(medal => [medal.id,medal])) as Record<ProfileMedalId,typeof profileMedalCatalog[number]>;
export const medalRules={ creation:'ruleCreation',streak:'ruleStreak',sharing:'ruleSharing',discussion:'ruleDiscussion',appreciation:'ruleAppreciation',discovery:'ruleDiscovery' } as const;
export const medalFamilyLabels={ creation:'seriesCreation',streak:'seriesStreak',sharing:'seriesSharing',discussion:'seriesDiscussion',appreciation:'seriesAppreciation',discovery:'seriesDiscovery' } as const;
export function MedalArt({ id,locked=false,small=false,hero=false }:{id:ProfileMedalId;locked?:boolean;small?:boolean;hero?:boolean}) {
  const medal=medalById[id];
  return <span className={styles.art} data-family={medal.family} data-tier={medal.tier} data-locked={locked || undefined} data-size={hero ? 'hero' : small ? 'compact' : 'grid'} aria-hidden>
    <Image className={styles.artImage} src={`/medals/v2/${id}.webp`} alt="" width={256} height={256} unoptimized draggable={false} />
    <span className={styles.foil} />
  </span>;
}

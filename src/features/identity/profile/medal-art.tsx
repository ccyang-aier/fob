import { profileMedalCatalog,type ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { BookmarkSimple,BookOpen,ChatCircleDots,ChatsCircle,Compass,GraduationCap,Heart,Lightbulb,Lightning,PencilSimple,Plant,Rocket,ShareNetwork,Sparkle,Star,Sun,Trophy,Users } from '@/components/icons';
import styles from './medal-wall.module.css';

export const medalById=Object.fromEntries(profileMedalCatalog.map(medal => [medal.id,medal])) as Record<ProfileMedalId,typeof profileMedalCatalog[number]>;
export const medalRules={ creation:'ruleCreation',streak:'ruleStreak',sharing:'ruleSharing',discussion:'ruleDiscussion',appreciation:'ruleAppreciation',discovery:'ruleDiscovery' } as const;
export const medalFamilyLabels={ creation:'seriesCreation',streak:'seriesStreak',sharing:'seriesSharing',discussion:'seriesDiscussion',appreciation:'seriesAppreciation',discovery:'seriesDiscovery' } as const;
const glyphs={ gardener:Plant,writer:PencilSimple,architect:BookOpen,creator:Lightning,steadfast:Sun,centurion:Trophy,sharing:ShareNetwork,connector:Rocket,beacon:Lightbulb,conversationalist:ChatCircleDots,collaborator:ChatsCircle,mentor:Users,appreciated:Heart,resonant:Star,influencer:Sparkle,explorer:Compass,curator:BookmarkSimple,navigator:GraduationCap };

export function MedalArt({ id,locked=false,small=false,hero=false }:{id:ProfileMedalId;locked?:boolean;small?:boolean;hero?:boolean}) {
  const Icon=glyphs[id],medal=medalById[id];
  return <span className={styles.art} data-family={medal.family} data-tier={medal.tier} data-locked={locked || undefined} data-size={hero ? 'hero' : small ? 'compact' : 'grid'} aria-hidden>
    <span className={styles.coin}><Icon size={hero ? 32 : small ? 24 : 22} /></span>
  </span>;
}

import type { ProfileMedalId } from '@fob/shared/knowledge/contracts';
import { PencilSimple, Plant, ShareNetwork } from '@/components/icons';
import styles from './medal-wall.module.css';

export const medalRules = { gardener: 'gardenerRule',creator: 'creatorRule',sharing: 'sharingRule' } as const;
const glyphs = { gardener: Plant,creator: PencilSimple,sharing: ShareNetwork };

export function MedalArt({ id, locked = false, small = false }: { id: ProfileMedalId; locked?: boolean; small?: boolean }) {
  const Icon = glyphs[id];
  return <span className={styles.art} data-medal={id} data-locked={locked || undefined} data-small={small || undefined} aria-hidden>
    <span className={styles.coin}><Icon size={small ? 22 : 26} /></span>
  </span>;
}

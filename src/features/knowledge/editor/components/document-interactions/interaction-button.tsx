'use client';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Coffee, StarSparkle } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import styles from './styles.module.css';
const rays = [[0,-24],[17,-17],[24,0],[17,17],[0,24],[-17,17],[-24,0],[-17,-17]];
export function InteractionButton({ label, effect, active, count, disabled, busy, sequence = 0, onClick, children }: {
  label: string; effect: 'like' | 'coffee' | 'comment'; active?: boolean; count?: number; disabled?: boolean; busy?: boolean; sequence?: number; onClick(): void; children: ReactNode;
}) {
  const [celebrating, setCelebrating] = useState(false);
  useEffect(() => {
    if (!sequence) return;
    const start = requestAnimationFrame(() => setCelebrating(true));
    const timer = setTimeout(() => setCelebrating(false), 950);
    return () => { cancelAnimationFrame(start); clearTimeout(timer); };
  }, [sequence]);
  return <Tooltip><TooltipTrigger asChild><button type="button" className={`fob-action ${styles.action}`} data-surface="plain" data-variant="hover" data-effect={effect}
    data-active-icon={active || undefined} aria-pressed={effect === 'like' ? !!active : undefined} aria-expanded={effect === 'comment' ? !!active : undefined}
    aria-busy={busy || undefined} aria-label={label} disabled={disabled} onClick={onClick}>
    <span key={sequence} className={styles.motion} data-celebrating={celebrating || undefined} aria-hidden>{children}
      {celebrating && <span className={styles.burst}>{rays.map(([x,y], index) => <span key={index} className={styles.particle} style={{ '--x': `${x}px`, '--y': `${y}px`, '--delay': `${index % 3 * 25}ms` } as CSSProperties} />)}
        {effect === 'coffee' ? <><Coffee size="12px" className={styles.flyingCup} /><span className={styles.steam} /></> : <StarSparkle size="12px" className={styles.sparkle} />}
      </span>}
    </span>
    {!!count && <span className={styles.count}>{count}</span>}
  </button></TooltipTrigger><TooltipContent>{label}</TooltipContent></Tooltip>;
}

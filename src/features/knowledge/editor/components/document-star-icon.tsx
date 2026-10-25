'use client';

import { Star, StarOutline, StarSparkle } from '@/components/icons';
import { useState, type CSSProperties } from 'react';
import styles from './document-star-icon.module.css';

const rays = [[0, -22], [16, -16], [22, 0], [16, 16], [0, 22], [-16, 16], [-22, 0], [-16, -16]];

export function useDocumentStarFeedback(starred: boolean, onToggle: () => void) {
  const [celebrating, setCelebrating] = useState(false);
  return {
    celebrating: celebrating && starred,
    toggle: () => { setCelebrating(!starred); onToggle(); },
    finish: () => setCelebrating(false),
  };
}

export function DocumentStarIcon({ starred, celebrating, onAnimationEnd, size = 16 }: {
  starred: boolean;
  celebrating: boolean;
  onAnimationEnd: () => void;
  size?: number;
}) {
  return <span className={styles.icon} aria-hidden data-starred={starred || undefined} data-celebrating={celebrating || undefined} style={{ width: size, height: size }}>
    {starred ? <Star className={styles.star} size={size} onAnimationEnd={onAnimationEnd} /> : <StarOutline className={styles.star} size={size} onAnimationEnd={onAnimationEnd} />}
    {celebrating ? <span className={styles.burst}>
      {rays.map(([x, y], index) => <span key={index} className={styles.ray} style={{ '--ray-x': `${x}px`, '--ray-y': `${y}px`, '--ray-angle': `${index * 45}deg`, '--ray-delay': `${index % 2 * 30}ms` } as CSSProperties} />)}
      <StarSparkle size={14} className={styles.sparkle} />
    </span> : null}
  </span>;
}

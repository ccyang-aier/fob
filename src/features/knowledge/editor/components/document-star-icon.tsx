'use client';

import { useState, type CSSProperties } from 'react';
import { Star } from '@phosphor-icons/react';
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

export function DocumentStarIcon({ starred, celebrating, onAnimationEnd, size = 18 }: {
  starred: boolean;
  celebrating: boolean;
  onAnimationEnd: () => void;
  size?: number;
}) {
  return <span className={styles.icon} aria-hidden data-starred={starred || undefined} data-celebrating={celebrating || undefined} style={{ width: size, height: size }}>
    <Star className={styles.star} size={size} weight={starred ? 'fill' : 'bold'} onAnimationEnd={onAnimationEnd} />
    {celebrating ? <span className={styles.burst}>
      {rays.map(([x, y], index) => <span key={index} className={styles.ray} style={{ '--ray-x': `${x}px`, '--ray-y': `${y}px`, '--ray-angle': `${index * 45}deg`, '--ray-delay': `${index % 2 * 30}ms` } as CSSProperties} />)}
      <svg className={styles.sparkle} viewBox="0 0 14 14" fill="currentColor"><path d="M7 0 8.8 5.2 14 7 8.8 8.8 7 14 5.2 8.8 0 7 5.2 5.2Z" /></svg>
    </span> : null}
  </span>;
}

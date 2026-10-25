'use client';

import GradientASCII from '@/components/backgrounds/gradient-ascii';
import styles from './auth-backdrop.module.css';

const COLORS = ['#1e3fd8', '#f6f8ff', '#a5d8ff', '#38bdf8'];

export function AuthBackdrop() {
  return (
    <GradientASCII
      className={styles.backdrop}
      colors={COLORS}
      shape="horizon"
      characters=" =+xX0S8#@"
      cellSize={18}
      density={0.8}
      glyphOpacity={0.85}
      glow={0.2}
      depthOfField={0}
      flicker={0.2}
      softness={0.5}
      scale={1}
      flow={0.5}
      speed={1}
      gradientOpacity={0.9}
      grain={0.08}
      variation={0}
      mouseInteraction
      scrambleRadius={0.1}
      clickEffect="wave"
      intro
      lightMode={false}
      aria-hidden="true"
    />
  );
}

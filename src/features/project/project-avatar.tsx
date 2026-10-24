'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import styles from './project-avatar.module.css';
import { attachProjectAvatar, hashProjectAvatarSeed, PROJECT_AVATAR_RENDER_SIZE } from './project-avatar-renderer';

export const PROJECT_AVATAR_PALETTES = [
  { id: 'lagoon', label: 'Lagoon', colors: ['#becce9', '#eff7a5', '#52dfbb', '#27b8e2'] },
  { id: 'iris', label: 'Iris', colors: ['#c9c5f2', '#d8a9eb', '#ee9baf', '#888be3'] },
  { id: 'sky', label: 'Sky', colors: ['#bdc8f1', '#b4eaf0', '#78b7e7', '#a49be9'] },
  { id: 'citrus', label: 'Citrus', colors: ['#f9dd92', '#f4f5a2', '#55decb', '#67cfe2'] },
  { id: 'meadow', label: 'Meadow', colors: ['#cceca2', '#e9f7a5', '#75dbbd', '#5db6dc'] },
  { id: 'coral', label: 'Coral', colors: ['#f5bbcd', '#ffdeaa', '#f3a071', '#ed87a5'] },
] as const;

export type ProjectAvatarPalette = (typeof PROJECT_AVATAR_PALETTES)[number]['id'];

export function resolveProjectAvatarPalette(seed: string, palette?: ProjectAvatarPalette) {
  return PROJECT_AVATAR_PALETTES.find(entry => entry.id === palette)
    ?? PROJECT_AVATAR_PALETTES[hashProjectAvatarSeed(seed) % PROJECT_AVATAR_PALETTES.length];
}

export function ProjectAvatar({ seed = 'fob', palette, preview = false, className }: {
  seed?: string;
  palette?: ProjectAvatarPalette;
  preview?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedPalette = resolveProjectAvatarPalette(seed, palette);

  useEffect(() => {
    if (canvasRef.current) return attachProjectAvatar(canvasRef.current, seed, selectedPalette, preview);
  }, [seed, selectedPalette, preview]);

  return (
    <span className={cn(styles.avatar, className)} aria-hidden="true" data-palette={selectedPalette.id}>
      <canvas ref={canvasRef} width={PROJECT_AVATAR_RENDER_SIZE} height={PROJECT_AVATAR_RENDER_SIZE} className={styles.canvas} />
    </span>
  );
}

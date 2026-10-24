'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import styles from './knowledge-base-avatar.module.css';
import { attachKnowledgeBaseAvatar, hashKnowledgeBaseAvatarSeed, KNOWLEDGE_BASE_AVATAR_RENDER_SIZE } from './knowledge-base-avatar-renderer';

export const KNOWLEDGE_BASE_AVATAR_PALETTES = [
  { id: 'lagoon', label: 'Lagoon', colors: ['#becce9', '#eff7a5', '#52dfbb', '#27b8e2'] },
  { id: 'iris', label: 'Iris', colors: ['#c9c5f2', '#d8a9eb', '#ee9baf', '#888be3'] },
  { id: 'sky', label: 'Sky', colors: ['#bdc8f1', '#b4eaf0', '#78b7e7', '#a49be9'] },
  { id: 'citrus', label: 'Citrus', colors: ['#f9dd92', '#f4f5a2', '#55decb', '#67cfe2'] },
  { id: 'meadow', label: 'Meadow', colors: ['#cceca2', '#e9f7a5', '#75dbbd', '#5db6dc'] },
  { id: 'coral', label: 'Coral', colors: ['#f5bbcd', '#ffdeaa', '#f3a071', '#ed87a5'] },
] as const;

export type KnowledgeBaseAvatarPalette = (typeof KNOWLEDGE_BASE_AVATAR_PALETTES)[number]['id'];

export function resolveKnowledgeBaseAvatarPalette(seed: string, palette?: KnowledgeBaseAvatarPalette) {
  return KNOWLEDGE_BASE_AVATAR_PALETTES.find(entry => entry.id === palette)
    ?? KNOWLEDGE_BASE_AVATAR_PALETTES[hashKnowledgeBaseAvatarSeed(seed) % KNOWLEDGE_BASE_AVATAR_PALETTES.length];
}

export function KnowledgeBaseAvatar({ seed = 'fob', palette, preview = false, className }: {
  seed?: string;
  palette?: KnowledgeBaseAvatarPalette;
  preview?: boolean;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectedPalette = resolveKnowledgeBaseAvatarPalette(seed, palette);

  useEffect(() => {
    if (canvasRef.current) return attachKnowledgeBaseAvatar(canvasRef.current, seed, selectedPalette, preview);
  }, [seed, selectedPalette, preview]);

  return (
    <span className={cn(styles.avatar, className)} aria-hidden="true" data-palette={selectedPalette.id}>
      <canvas ref={canvasRef} width={KNOWLEDGE_BASE_AVATAR_RENDER_SIZE} height={KNOWLEDGE_BASE_AVATAR_RENDER_SIZE} className={styles.canvas} />
    </span>
  );
}

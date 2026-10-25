'use client';

import { useRef } from 'react';
import { useTranslation } from '@/lib/i18n';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

export function BlockResize({ height, onChange, min = 240 }: { height: number; onChange: (height: number) => void; min?: number }) {
  const { t } = useTranslation(richMessages);
  const start = useRef<{ y: number; height: number } | null>(null);
  return <div role="separator" aria-orientation="horizontal" aria-label={t('resize')} aria-valuenow={height} aria-valuemin={min} aria-valuemax={1200} className={`fob-resize-handle ${styles.resize}`} tabIndex={0} data-resize-axis="y" data-document-export-omit
    onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.dataset.resizing = 'true'; start.current = { y: event.clientY, height }; }}
    onPointerMove={event => { if (start.current) onChange(Math.round(Math.max(min, Math.min(1200, start.current.height + event.clientY - start.current.y)))); }}
    onPointerUp={event => { start.current = null; event.currentTarget.dataset.resizing = 'false'; }} onPointerCancel={event => { start.current = null; event.currentTarget.dataset.resizing = 'false'; }}
    onLostPointerCapture={event => { start.current = null; event.currentTarget.dataset.resizing = 'false'; }}
    onKeyDown={event => { if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return; event.preventDefault(); onChange(Math.max(min, Math.min(1200, height + (event.key === 'ArrowDown' ? 20 : -20)))); }} />;
}

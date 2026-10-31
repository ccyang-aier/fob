'use client';

import { useId, useState } from 'react';
import { ArrowsOutLineHorizontal, Minus, Plus } from '@/components/icons';
import { AnchoredPopover } from '@/components/ui/anchored-popover';
import { useTranslation } from '@/lib/i18n';
import { GraphicToolButton } from './graphic-tool-button';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

function DimensionField({ label, value, min, max, step, unit, decreaseLabel, increaseLabel, onChange }: {
  label: string; value: number; min: number; max: number; step: number; unit: string;
  decreaseLabel: string; increaseLabel: string; onChange: (value: number) => void;
}) {
  const id = useId();
  const clamp = (next: number) => Math.max(min, Math.min(max, Math.round(next)));
  return <div className={styles.dimensionRow}>
    <label htmlFor={id}>{label}</label>
    <div className={styles.dimensionControl}>
      <button type="button" className="fob-action" data-surface="plain" aria-label={decreaseLabel} disabled={value <= min} onClick={() => onChange(clamp(value - step))}><Minus size={14} aria-hidden /></button>
      <div className={styles.dimensionValue}><input key={value} id={id} type="number" inputMode="numeric" defaultValue={value} min={min} max={max} step={step} onBlur={event => {
        const next = event.target.value.trim() ? Number(event.target.value) : NaN;
        if (Number.isFinite(next)) onChange(clamp(next));
        event.target.value = String(Number.isFinite(next) ? clamp(next) : value);
      }} onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') event.currentTarget.value = String(value);
      }} /><span aria-hidden>{unit}</span></div>
      <button type="button" className="fob-action" data-surface="plain" aria-label={increaseLabel} disabled={value >= max} onClick={() => onChange(clamp(value + step))}><Plus size={14} aria-hidden /></button>
    </div>
  </div>;
}

export function GraphicBlockSize({ width, height, defaultHeight, minHeight, onChange }: {
  width: number; height: number; defaultHeight: number; minHeight: number;
  onChange: (size: { width?: number; height?: number }) => void;
}) {
  const { t } = useTranslation(richMessages);
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const presets = [
    { label: t('sizeCompact'), width: 75, height: 280 },
    { label: t('sizeStandard'), width: 100, height: defaultHeight },
    { label: t('sizeLarge'), width: 100, height: 640 },
  ];
  return <>
    <GraphicToolButton label={t('blockSize')} aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onClick={event => setAnchor(anchor ? null : event.currentTarget)}><ArrowsOutLineHorizontal size={16} aria-hidden /></GraphicToolButton>
    {anchor && <AnchoredPopover anchor={anchor} align="end" width={252} label={t('blockSize')} onClose={() => setAnchor(null)} className={styles.sizePopover}>
      <div className={styles.sizePresets}>
        {presets.map(preset => <button key={preset.label} type="button" className="fob-action" data-surface="plain" aria-pressed={width === preset.width && height === preset.height} onClick={() => onChange({ width: preset.width, height: preset.height })}>{preset.label}</button>)}
      </div>
      <DimensionField label={t('width')} value={width} min={25} max={100} step={10} unit="%" decreaseLabel={t('decreaseWidth')} increaseLabel={t('increaseWidth')} onChange={width => onChange({ width })} />
      <DimensionField label={t('height')} value={height} min={minHeight} max={1200} step={40} unit="px" decreaseLabel={t('decreaseHeight')} increaseLabel={t('increaseHeight')} onChange={height => onChange({ height })} />
      <button type="button" className={`fob-action ${styles.resetSize}`} data-surface="plain" onClick={() => onChange({ width: 100, height: defaultHeight })}>{t('resetSize')}</button>
    </AnchoredPopover>}
  </>;
}

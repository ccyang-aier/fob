'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './table-color-picker.messages';
import { useState, type CSSProperties, type PointerEvent } from 'react';
import { Check, Copy } from '@/components/icons';
import { clamp, formatTableColor, parseTableColor, type TableColor } from './table-color';
import styles from './table.module.css';

export function TableColorPicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (hex: string) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const parsed = parseTableColor(value ?? '#7e3d3db3')!;
  const [hue, setHue] = useState(parsed.h);
  const [draft, setDraft] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const color = { ...parsed, h: parsed.s === 0 || parsed.v === 0 ? hue : parsed.h };
  const hex = formatTableColor(color);
  const update = (next: TableColor) => {
    setHue(next.h);
    setCopyState('idle');
    const nextHex = formatTableColor(next);
    if (nextHex !== value?.toLowerCase()) onChange(nextHex);
  };
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    update({
      ...color,
      s: clamp((event.clientX - bounds.left) / bounds.width),
      v: 1 - clamp((event.clientY - bounds.top) / bounds.height),
    });
  };
  const commit = () => {
    if (draft === null) return;
    const next = parseTableColor(draft.trim());
    if (next) update(next);
    setDraft(null);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(hex);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };
  return (
    <div
      className={styles.colorPicker}
      style={
        {
          '--picker-hue': `hsl(${color.h} 100% 50%)`,
          '--picker-color': formatTableColor({ ...color, a: 1 }),
        } as CSSProperties
      }
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        event.preventDefault();
        event.stopPropagation();
        const inputs = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>('[tabindex="0"], input, button'),
        );
        const current = inputs.indexOf(
          event.currentTarget.ownerDocument.activeElement as HTMLElement,
        );
        inputs[(current + (event.shiftKey ? -1 : 1) + inputs.length) % inputs.length]?.focus();
      }}
    >
      <div
        className={styles.colorPlane}
        role="slider"
        aria-label={knowledgeT('saturationAndBrightness')}
        aria-valuetext={knowledgeT('saturationValueBrightnessValue', {
          v0: Math.round(color.s * 100),
          v1: Math.round(color.v * 100),
        })}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(color.s * 100)}
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          event.currentTarget.focus();
          event.currentTarget.setPointerCapture(event.pointerId);
          pick(event);
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event);
        }}
        onPointerUp={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          event.preventDefault();
          event.stopPropagation();
          const step = event.shiftKey ? 0.1 : 0.01;
          update({
            ...color,
            s: clamp(
              color.s + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0),
            ),
            v: clamp(
              color.v + (event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0),
            ),
          });
        }}
      >
        <span
          className={styles.colorMarker}
          style={{ left: `${color.s * 100}%`, top: `${(1 - color.v) * 100}%` }}
        />
      </div>
      <input
        className={`${styles.colorRange} ${styles.hueRange}`}
        type="range"
        min={0}
        max={359}
        step={1}
        aria-label={knowledgeT('hue')}
        value={Math.round(color.h)}
        onChange={(event) => update({ ...color, h: Number(event.target.value) })}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        }}
      />
      <input
        className={`${styles.colorRange} ${styles.alphaRange}`}
        type="range"
        min={0}
        max={100}
        step={1}
        aria-label={knowledgeT('opacity')}
        value={Math.round(color.a * 100)}
        onChange={(event) => update({ ...color, a: Number(event.target.value) / 100 })}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
        }}
      />
      <div className={styles.hexRow}>
        <input
          className={styles.hexInput}
          aria-label={knowledgeT('hexColor')}
          aria-invalid={(draft !== null && !parseTableColor(draft.trim())) || undefined}
          spellCheck={false}
          value={draft ?? hex}
          onChange={(event) => {
            setDraft(event.target.value);
            setCopyState('idle');
            const next = parseTableColor(event.target.value.trim());
            if (next) update(next);
          }}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' && event.key !== 'Tab') event.stopPropagation();
            if (event.key === 'Enter') {
              event.preventDefault();
              commit();
            } else if (event.key === 'Escape') setDraft(null);
          }}
        />
        <button
          type="button"
          className={styles.copyColor}
          aria-label={copyState === 'copied' ? knowledgeT('colorCopied') : knowledgeT('copyColor')}
          title={
            copyState === 'failed'
              ? knowledgeT('unableToCopyCopyTheColorValueManually')
              : knowledgeT('copyColorValue')
          }
          onClick={copy}
        >
          {copyState === 'copied' ? <Check size={16} /> : <Copy size={16} />}
        </button>
      </div>
      {copyState === 'failed' ? (
        <span className={styles.copyError} role="status">
          {knowledgeT('unableToCopyCopyTheColorValueManually')}
        </span>
      ) : null}
    </div>
  );
}

"use client"

import { Question } from '@/components/icons';
import { useEffect, useRef, useState, type ComponentProps } from "react"
import { cn } from "@/lib/utils"
import { createStarfieldEffect } from "./starfield-slider-effects"
import styles from "./starfield-slider.module.css"

type StarfieldSliderProps = Omit<ComponentProps<"input">, "type" | "value" | "min" | "max" | "step" | "onChange"> & {
  value: number
  levels: readonly string[]
  heading: string
  titleId: string
  onValueChange: (value: number) => void
}

export function StarfieldSlider({ value, levels, heading, titleId, onValueChange, className, disabled, ...inputProps }: StarfieldSliderProps) {
  const max = levels.length - 1
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const effectRef = useRef<ReturnType<typeof createStarfieldEffect>>(undefined)
  const [slider, setSlider] = useState({ value, max, percent: Math.round(value / max * 100) })
  if (slider.value !== value || slider.max !== max) {
    setSlider({ value, max, percent: Math.round(value / max * 100) })
  }
  const active = slider.percent === 100
  const maskEnd = Math.min(slider.percent + 2, 100)

  useEffect(() => {
    if (disabled || !canvasRef.current) return
    const effect = createStarfieldEffect(canvasRef.current)
    effectRef.current = effect
    return () => { effect?.dispose(); effectRef.current = undefined }
  }, [disabled])
  useEffect(() => { effectRef.current?.setStrength(slider.percent / 100) }, [slider.percent, disabled])

  return <>

    <div className={styles["card-shadow"]} data-disabled={disabled || undefined}>
      <div className={styles.card} style={{ clipPath: 'inset(0 round 14px)' }}>
        <div className={styles.header}>
          <span id={titleId} className={styles["label-text"]}>{heading}</span>
          <div className={styles["help-btn"]} aria-hidden="true"><Question size={16} /></div>
        </div>
        <div className={cn(styles["track-wrapper"], active && styles.active, active && styles.full)} style={{ clipPath: 'inset(0 round 6px)' }}>
          <div className={styles["track-bg"]} />
          <div className={styles["dots-layer"]}>{Array.from({ length: 5 }, (_, i) => <span key={i} className={styles.dot} />)}</div>
          <canvas ref={canvasRef} className={styles.field} style={{ maskImage: `linear-gradient(to right, black 0%, black ${maskEnd}%, transparent ${maskEnd}%)`, WebkitMaskImage: `linear-gradient(to right, black 0%, black ${maskEnd}%, transparent ${maskEnd}%)` }} />
          <input {...inputProps} type="range" min={0} max={100} step={1} value={slider.percent} disabled={disabled}
            className={cn(styles.input, active && styles.glowing, className)} onChange={event => {
              const percent = event.currentTarget.valueAsNumber
              const nextValue = percent === 100 ? max : Math.min(max - 1, Math.round(percent / 100 * max))
              setSlider({ value: nextValue, max, percent })
              if (nextValue !== value) onValueChange(nextValue)
            }} />
        </div>
        <div className={styles.levels} aria-hidden="true">{levels.map((level, index) =>
          <span key={level} data-current={index === value} style={{ left: `${index / max * 100}%` }}>{level}</span>
        )}</div>
      </div>
    </div>
  </>
}

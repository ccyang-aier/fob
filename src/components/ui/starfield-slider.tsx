"use client"

import { useEffect, useId, useRef, useState, type ComponentProps } from "react"
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
  const id = useId()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const effectRef = useRef<ReturnType<typeof createStarfieldEffect>>(undefined)
  const [slider, setSlider] = useState({ value, max, percent: Math.round(value / max * 100) })
  if (slider.value !== value || slider.max !== max) {
    setSlider({ value, max, percent: Math.round(value / max * 100) })
  }
  const active = slider.percent === 100
  const maskEnd = Math.min(slider.percent + 2, 100)
  const clipId = `${id}-card`
  const trackClipId = `${id}-track`

  useEffect(() => {
    if (disabled || !canvasRef.current) return
    const effect = createStarfieldEffect(canvasRef.current)
    effectRef.current = effect
    return () => { effect?.dispose(); effectRef.current = undefined }
  }, [disabled])
  useEffect(() => { effectRef.current?.setStrength(slider.percent / 100) }, [slider.percent, disabled])

  return <>
    <svg className={styles["squircle-clip"]} xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>
      <clipPath id={clipId} clipPathUnits="objectBoundingBox"><path d="M 0.053,0 C 0.029,0 0.012,0.008 0.005,0.02 C 0.002,0.028 0,0.038 0,0.053 L 0,0.947 C 0,0.962 0.002,0.972 0.005,0.98 C 0.012,0.992 0.029,1 0.053,1 L 0.947,1 C 0.971,1 0.988,0.992 0.995,0.98 C 0.998,0.972 1,0.962 1,0.947 L 1,0.053 C 1,0.038 0.998,0.028 0.995,0.02 C 0.988,0.008 0.971,0 0.947,0 Z" /></clipPath>
      <clipPath id={trackClipId} clipPathUnits="objectBoundingBox"><path d="M 0.033,0 C 0.018,0 0.007,0.012 0.003,0.035 C 0.001,0.055 0,0.1 0,0.15 L 0,0.85 C 0,0.9 0.001,0.945 0.003,0.965 C 0.007,0.988 0.018,1 0.033,1 L 0.967,1 C 0.982,1 0.993,0.988 0.997,0.965 C 0.999,0.945 1,0.9 1,0.85 L 1,0.15 C 1,0.1 0.999,0.055 0.997,0.035 C 0.993,0.012 0.982,0 0.967,0 Z" /></clipPath>
    </defs></svg>
    <div className={styles["card-shadow"]} data-disabled={disabled || undefined}>
      <div className={styles.card} style={{ clipPath: `url(#${clipId})` }}>
        <div className={styles.header}>
          <span id={titleId} className={styles["label-text"]}>{heading}</span>
          <div className={styles["help-btn"]} aria-hidden="true"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z" /></svg></div>
        </div>
        <div className={cn(styles["track-wrapper"], active && styles.active, active && styles.full)} style={{ clipPath: `url(#${trackClipId})` }}>
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

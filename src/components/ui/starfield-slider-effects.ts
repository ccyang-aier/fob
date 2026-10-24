import { createStarfieldRenderer } from "./starfield-slider-renderer"

/** React lifecycle adapter for the reference's unmodified rendering pipeline. */
export function createStarfieldEffect(canvas: HTMLCanvasElement) {
  let renderer = createStarfieldRenderer(canvas)
  if (!renderer) return
  const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
  let frame = 0
  let position = 0
  let startedAt = 0
  let wasActive = false
  let idleFrames = 0

  function render(now: number) {
    const active = position === 1
    if (!active && !wasActive) {
      if (++idleFrames > 180) { frame = 0; return }
      frame = requestAnimationFrame(render)
      return
    }
    idleFrames = 0
    if (active && !wasActive) renderer?.clear()
    wasActive = active
    renderer?.draw(now * 0.001, position, active ? (performance.now() - startedAt) / 1000 : -1)
    frame = requestAnimationFrame(render)
  }

  function refresh() {
    cancelAnimationFrame(frame)
    frame = 0
    if (!renderer || document.hidden || position !== 1) return
    if (motion.matches) {
      renderer.clear()
      for (let i = 0; i < 24; i++) renderer.draw(1.5, position, 4)
      return
    }
    wasActive = false
    idleFrames = 0
    startedAt = performance.now()
    renderer.clear()
    frame = requestAnimationFrame(render)
  }

  function resize() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    renderer?.resize(rect.width, rect.height)
    refresh()
  }

  function contextLost(event: Event) {
    event.preventDefault()
    cancelAnimationFrame(frame)
    frame = 0
    renderer?.dispose()
    renderer = undefined
  }

  function contextRestored() {
    renderer = createStarfieldRenderer(canvas)
    resize()
  }

  const observer = new ResizeObserver(resize)
  observer.observe(canvas)
  canvas.addEventListener("webglcontextlost", contextLost)
  canvas.addEventListener("webglcontextrestored", contextRestored)
  document.addEventListener("visibilitychange", refresh)
  motion.addEventListener("change", refresh)
  resize()

  return {
    setStrength(value: number) {
      const previous = position
      position = value
      if ((value === 1) !== (previous === 1)) {
        if (value === 1) refresh()
        else if (motion.matches) renderer?.draw(1.5, value, -1)
      }
    },
    dispose() {
      cancelAnimationFrame(frame)
      observer.disconnect()
      canvas.removeEventListener("webglcontextlost", contextLost)
      canvas.removeEventListener("webglcontextrestored", contextRestored)
      document.removeEventListener("visibilitychange", refresh)
      motion.removeEventListener("change", refresh)
      renderer?.dispose()
    },
  }
}

import { advanceKnowledgeBaseFluid, createKnowledgeBaseFluid, FLUID_SIZE, FLUID_STRIDE, type KnowledgeBaseFluid } from './knowledge-base-avatar-fluid';

type RGB = readonly [number, number, number];
type FluidState = { field: KnowledgeBaseFluid; lastFrame: number };
type Surface = {
  pixels: ImageData;
  pigments: readonly RGB[];
  fluid: FluidState;
  targets: Map<HTMLCanvasElement, { context: CanvasRenderingContext2D; visible: boolean }>;
};

export const KNOWLEDGE_BASE_AVATAR_RENDER_SIZE = 48;
const SIZE = KNOWLEDGE_BASE_AVATAR_RENDER_SIZE;
const FRAME_DURATION = 1000 / 24;
const FLOW_SPEED = 2.2;
const MAX_SIMULATION_STEP = 1 / 24;
const MAX_IDLE_FLUIDS = 24;
const surfaces = new Map<string, Surface>();
const fluids = new Map<string, FluidState>();
const canvasSurfaces = new Map<HTMLCanvasElement, Surface>();
let observer: IntersectionObserver | null = null;
let animationFrame = 0;
let previousFrame = 0;

export function hashKnowledgeBaseAvatarSeed(seed: string) {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index++) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  return hash >>> 0;
}

function parseColor(color: string): RGB {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >>> 16) & 255, (value >>> 8) & 255, value & 255];
}

function paint(surface: Surface) {
  const { ink } = surface.fluid.field;
  const { pigments, pixels } = surface;
  for (let row = 0; row < SIZE; row++) for (let column = 0; column < SIZE; column++) {
    const x = .5 + column / (SIZE - 1) * FLUID_SIZE;
    const y = .5 + row / (SIZE - 1) * FLUID_SIZE;
    const left = Math.floor(x), top = Math.floor(y);
    const fx = x - left, fy = y - top;
    const a = (left + top * FLUID_STRIDE) * 4;
    let red = 0, green = 0, blue = 0, total = 0, purity = 0;
    for (let c = 0; c < 4; c++) {
      const concentration = (ink[a + c] * (1 - fx) + ink[a + 4 + c] * fx) * (1 - fy)
        + (ink[a + FLUID_STRIDE * 4 + c] * (1 - fx) + ink[a + FLUID_STRIDE * 4 + 4 + c] * fx) * fy;
      const weight = Math.pow(Math.max(0, concentration), 1.45);
      red += pigments[c][0] * weight;
      green += pigments[c][1] * weight;
      blue += pigments[c][2] * weight;
      total += weight;
      purity += concentration * concentration;
    }
    // Broad satin lighting follows pigment density; no embossed contour ribbons.
    const relief = .96 + .035 * (1 - row / SIZE) + (purity - .5) * .045;
    const light = .014;
    const offset = (row * SIZE + column) * 4;
    pixels.data[offset] = red / total * relief * (1 - light) + 255 * light;
    pixels.data[offset + 1] = green / total * relief * (1 - light) + 255 * light;
    pixels.data[offset + 2] = blue / total * relief * (1 - light) + 255 * light;
    pixels.data[offset + 3] = 255;
  }
  for (const target of surface.targets.values()) if (target.visible) target.context.putImageData(pixels, 0, 0);
}

function isVisible(surface: Surface) {
  for (const target of surface.targets.values()) if (target.visible) return true;
  return false;
}

function hasVisibleTargets() {
  for (const surface of surfaces.values()) if (isVisible(surface)) return true;
  return false;
}

function animate(timestamp: number) {
  animationFrame = 0;
  if (!hasVisibleTargets()) return;
  if (timestamp - previousFrame >= FRAME_DURATION) {
    previousFrame = timestamp;
    const activeFluids = new Set<FluidState>();
    for (const surface of surfaces.values()) if (isVisible(surface)) activeFluids.add(surface.fluid);
    for (const fluid of activeFluids) {
      const elapsed = Math.max(0, Math.min((timestamp - fluid.lastFrame) / 1000, .075)) * FLOW_SPEED;
      // Faster transport still uses small physical steps, keeping curls continuous.
      const steps = Math.ceil(elapsed / MAX_SIMULATION_STEP);
      for (let step = 0; step < steps; step++) advanceKnowledgeBaseFluid(fluid.field, elapsed / steps);
      fluid.lastFrame = timestamp;
    }
    for (const surface of surfaces.values()) if (isVisible(surface)) paint(surface);
  }
  animationFrame = requestAnimationFrame(animate);
}

function startAnimation() {
  if (!animationFrame && hasVisibleTargets()) animationFrame = requestAnimationFrame(animate);
}

function trimIdleFluids() {
  const active = new Set(Array.from(surfaces.values(), surface => surface.fluid));
  let idle = fluids.size - active.size;
  for (const [key, fluid] of fluids) {
    if (idle <= MAX_IDLE_FLUIDS) break;
    if (!active.has(fluid)) { fluids.delete(key); idle--; }
  }
}

export function attachKnowledgeBaseAvatar(canvas: HTMLCanvasElement, seed: string, palette: { id: string; colors: readonly string[] }, preview = false) {
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) return;
  const flowKey = JSON.stringify([seed, preview ? palette.id : null]);
  const key = JSON.stringify([flowKey, palette.id]);
  let surface = surfaces.get(key);
  if (!surface) {
    let fluid = fluids.get(flowKey);
    if (!fluid) {
      // KnowledgeBase IDs choose the default palette, never a fixed opening picture.
      const randomSeed = crypto.getRandomValues(new Uint32Array(1))[0];
      fluid = { field: createKnowledgeBaseFluid(randomSeed), lastFrame: performance.now() };
    }
    // Touch this flow in the bounded session cache. Reopening a menu resumes it.
    fluids.delete(flowKey);
    fluids.set(flowKey, fluid);
    surface = { pixels: context.createImageData(SIZE, SIZE), pigments: palette.colors.map(parseColor), fluid, targets: new Map() };
    surfaces.set(key, surface);
    trimIdleFluids();
  }
  surface.targets.set(canvas, { context, visible: true });
  canvasSurfaces.set(canvas, surface);
  paint(surface);
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      const target = canvasSurfaces.get(entry.target as HTMLCanvasElement)?.targets.get(entry.target as HTMLCanvasElement);
      if (target) target.visible = entry.isIntersecting;
    }
    startAnimation();
  }, { rootMargin: '48px' });
  observer.observe(canvas);
  startAnimation();

  return () => {
    observer?.unobserve(canvas);
    canvasSurfaces.delete(canvas);
    surface.targets.delete(canvas);
    if (!surface.targets.size) {
      surfaces.delete(key);
      // A long-lived visible knowledge base is the most recently used flow on detach.
      fluids.delete(flowKey);
      fluids.set(flowKey, surface.fluid);
    }
    trimIdleFluids();
    if (!surfaces.size) {
      observer?.disconnect();
      observer = null;
      cancelAnimationFrame(animationFrame);
      animationFrame = 0;
      previousFrame = 0;
    }
  };
}

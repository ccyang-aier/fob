import { afterAll, afterEach, beforeAll, expect, test } from 'bun:test';
import { attachKnowledgeBaseAvatar, KNOWLEDGE_BASE_AVATAR_RENDER_SIZE } from './knowledge-base-avatar-renderer';

const palette = { id: 'lagoon', colors: ['#becce9', '#eff7a5', '#52dfbb', '#27b8e2'] };
const frames = new Map<number, FrameRequestCallback>();
const cleanups = new Set<() => void>();
const previous = new Map<string, unknown>();
let frameId = 0, clock = performance.now();
let onIntersection: IntersectionObserverCallback;

beforeAll(() => {
  const globals = globalThis as Record<string, unknown>;
  const replacements = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    IntersectionObserver: class {
      constructor(callback: IntersectionObserverCallback) { onIntersection = callback; }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  };
  for (const [name, replacement] of Object.entries(replacements)) {
    previous.set(name, globals[name]);
    globals[name] = replacement;
  }
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  expect(frames.size).toBe(0);
});
afterAll(() => {
  const globals = globalThis as Record<string, unknown>;
  for (const [name, value] of previous) {
    if (value === undefined) delete globals[name]; else globals[name] = value;
  }
});

function mount(seed: string, selected = palette, preview = false) {
  let pixels = new Uint8ClampedArray(), paints = 0;
  const canvas = {
    getContext: () => ({
      createImageData: () => ({ data: new Uint8ClampedArray(KNOWLEDGE_BASE_AVATAR_RENDER_SIZE ** 2 * 4) }),
      putImageData: (image: ImageData) => { pixels = image.data.slice(); paints++; },
    }),
  } as unknown as HTMLCanvasElement;
  const detach = attachKnowledgeBaseAvatar(canvas, seed, selected, preview)!;
  const unmount = () => { detach(); cleanups.delete(unmount); };
  cleanups.add(unmount);
  return { canvas, unmount, pixels: () => pixels, paints: () => paints };
}
function advance(milliseconds: number) {
  for (let elapsed = 0; elapsed < milliseconds; elapsed += 50) {
    clock = Math.max(clock + 50, performance.now() + 50);
    const pending = Array.from(frames.values());
    frames.clear();
    for (const callback of pending) callback(clock);
  }
}
function visible(canvas: HTMLCanvasElement, isIntersecting: boolean) {
  onIntersection([{ target: canvas, isIntersecting } as unknown as IntersectionObserverEntry], {} as IntersectionObserver);
}

test('visible pigment keeps evolving while duplicate project icons stay synchronized', () => {
  const header = mount('live-project'), list = mount('live-project');
  const opening = header.pixels();
  expect(list.pixels()).toEqual(opening);
  advance(4000);
  expect(header.pixels()).not.toEqual(opening);
  expect(header.pixels()).toEqual(list.pixels());
  expect(header.paints()).toBeGreaterThan(40);
  const middle = header.pixels();
  advance(4000);
  expect(header.pixels()).not.toEqual(middle);
});

test('palette previews have independent shapes, even with identical dye colors', () => {
  const project = mount('preview-project');
  const first = mount('preview-project', palette, true);
  const second = mount('preview-project', { ...palette, id: 'iris' }, true);
  expect(first.pixels()).not.toEqual(project.pixels());
  expect(first.pixels()).not.toEqual(second.pixels());
  const firstOpening = first.pixels(), secondOpening = second.pixels();
  advance(4000);
  expect(first.pixels()).not.toEqual(firstOpening);
  expect(second.pixels()).not.toEqual(secondOpening);
  expect(first.pixels()).not.toEqual(second.pixels());
});

test('closing and reopening the menu resumes the previous fluid instead of replaying its opening', async () => {
  const first = mount('reopened-menu', palette, true);
  const opening = first.pixels();
  advance(4000);
  const beforeClose = first.pixels();
  first.unmount();
  await Promise.resolve();
  const reopened = mount('reopened-menu', palette, true);
  expect(reopened.pixels()).toEqual(beforeClose);
  expect(reopened.pixels()).not.toEqual(opening);
  advance(2000);
  expect(reopened.pixels()).not.toEqual(beforeClose);
});

test('changing the project palette preserves its fluid history', async () => {
  const first = mount('recolored-project');
  advance(3000);
  const beforeChange = first.pixels();
  first.unmount();
  await Promise.resolve();
  // Equal dye colors isolate continuity of shape from the recoloring itself.
  const recolored = mount('recolored-project', { ...palette, id: 'other' });
  expect(recolored.pixels()).toEqual(beforeChange);
});

test('invisible icons stop painting and resume when visible; the final detach stops scheduling', () => {
  const icon = mount('visibility-project');
  visible(icon.canvas, false);
  const beforeHide = icon.pixels(), paints = icon.paints();
  advance(4000);
  expect(icon.paints()).toBe(paints);
  expect(frames.size).toBe(0);
  visible(icon.canvas, true);
  advance(2000);
  expect(icon.pixels()).not.toEqual(beforeHide);
  icon.unmount();
  expect(frames.size).toBe(0);
});

test('evicted flows start with fresh random pigment instead of a project-ID opening picture', () => {
  const first = mount('new-session-project');
  const opening = first.pixels();
  first.unmount();
  for (let index = 0; index < 64; index++) mount(`other-project-${index}`).unmount();
  expect(mount('new-session-project').pixels()).not.toEqual(opening);
});

test('cache eviction never interrupts a visible project when its palette changes', () => {
  const project = mount('long-lived-project');
  advance(2000);
  const beforeChange = project.pixels();
  for (let index = 0; index < 64; index++) mount(`cached-project-${index}`).unmount();
  project.unmount();
  expect(mount('long-lived-project', { ...palette, id: 'recolored' }).pixels()).toEqual(beforeChange);
});

import plantumlPackage from '@plantuml/core/package.json';
import { validatePlantUmlSource, validatePlantUmlSvg, PLANTUML_SVG_LIMIT } from './source';

const cache = new Map<string, string>();
const { version } = plantumlPackage;
let cachedBytes = 0;
let active = 0;
const waiting: (() => void)[] = [];

async function reserve(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (active < 2) { active++; return; }
  await new Promise<void>((resolve, reject) => {
    const start = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const abort = () => { const index = waiting.indexOf(start); if (index !== -1) waiting.splice(index, 1); reject(signal?.reason); };
    waiting.push(start);
    signal?.addEventListener('abort', abort, { once: true });
  });
}
function release() { const next = waiting.shift(); if (next) next(); else active--; }

function renderInFrame(source: string, dark: boolean, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    const requestId = crypto.randomUUID();
    frame.hidden = true;
    frame.setAttribute('aria-hidden', 'true');
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.referrerPolicy = 'no-referrer';
    frame.src = `/vendor/plantuml/${version}/renderer.html`;
    const done = (error?: unknown, svg?: string) => {
      clearTimeout(timer);
      window.removeEventListener('message', message);
      signal?.removeEventListener('abort', abort);
      frame.remove();
      if (error) reject(error); else resolve(svg!);
    };
    const abort = () => done(signal?.reason ?? new Error('PlantUML rendering canceled'));
    const message = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return;
      if (event.data?.type === 'fob:plantuml-ready') {
        frame.contentWindow?.postMessage({ type: 'fob:plantuml-render', requestId, source, dark }, '*');
      } else if (event.data?.type === 'fob:plantuml-result' && event.data.requestId === requestId) {
        try {
          if (event.data.error || typeof event.data.svg !== 'string') throw new Error('PlantUML rendering failed');
          done(undefined, validatePlantUmlSvg(event.data.svg));
        } catch (cause) { done(cause); }
      }
    };
    const timer = setTimeout(() => done(new Error('PlantUML rendering timed out')), 15_000);
    window.addEventListener('message', message);
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort(); else document.body.append(frame);
  });
}

/** Versioned local assets, bounded rendering and a memory-only LRU; no remote diagram service. */
export async function renderPlantUml(source: string, dark: boolean, signal?: AbortSignal): Promise<string> {
  validatePlantUmlSource(source);
  signal?.throwIfAborted();
  const key = `${dark}\n${source}`;
  const cached = cache.get(key);
  if (cached) { cache.delete(key); cache.set(key, cached); return cached; }
  await reserve(signal);
  try {
    signal?.throwIfAborted();
    const svg = await renderInFrame(source, dark, signal);
    // Concurrent requests may have populated this exact entry while the frame was running.
    const previous = cache.get(key);
    if (previous) cachedBytes -= previous.length;
    cache.delete(key); cache.set(key, svg); cachedBytes += svg.length;
    while (cache.size > 16 || cachedBytes > PLANTUML_SVG_LIMIT * 4) {
      const oldest = cache.keys().next().value!;
      cachedBytes -= cache.get(oldest)!.length; cache.delete(oldest);
    }
    return svg;
  } finally { release(); }
}

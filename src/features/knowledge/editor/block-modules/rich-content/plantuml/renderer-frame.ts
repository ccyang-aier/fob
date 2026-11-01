import { renderToString } from '@plantuml/core';
import { validatePlantUmlSource, validatePlantUmlSvg } from './source';

type EngineGlobals = typeof globalThis & {
  PLANTUML_FILE_LOADER?: (path: string, from: string | null, ok: (id: string, text: string) => void, fail: (reason: string) => void) => void;
  PLANTUML_STDLIB_LOADER?: (url: string, ok: () => void, fail: (reason: string) => void) => boolean;
};
const engine = globalThis as EngineGlobals;
const supportFiles = new Set(['themes.js', 'emoji.js', 'openiconic.js']);
// No document contents, local files or include URLs leave this sandbox.
engine.PLANTUML_FILE_LOADER = (_path, _from, _ok, fail) => fail('External includes are unavailable');
engine.PLANTUML_STDLIB_LOADER = (url, ok, fail) => {
  if (!supportFiles.has(url)) { fail('This standard library is unavailable'); return true; }
  const script = document.createElement('script');
  script.src = new URL(url, location.href).href;
  script.onload = ok;
  script.onerror = () => fail('Unable to load PlantUML support assets');
  document.head.append(script);
  return true;
};

let rendering = false;
window.addEventListener('message', event => {
  const input = event.data;
  if (event.source !== parent || rendering || input?.type !== 'fob:plantuml-render' || typeof input.requestId !== 'string' || typeof input.source !== 'string' || typeof input.dark !== 'boolean') return;
  rendering = true;
  const reply = (result: { svg: string } | { error: true }) => parent.postMessage({ type: 'fob:plantuml-result', requestId: input.requestId, ...result }, event.origin);
  try {
    validatePlantUmlSource(input.source);
    renderToString(input.source.split(/\r\n?|\n/), svg => {
      try { reply({ svg: validatePlantUmlSvg(svg) }); }
      catch { reply({ error: true }); }
    }, () => reply({ error: true }), { dark: input.dark, maxSvgSize: 4096 });
  } catch { reply({ error: true }); }
});
parent.postMessage({ type: 'fob:plantuml-ready' }, '*');

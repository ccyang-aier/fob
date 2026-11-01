import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { buildSync } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fonts are served by Fob, including when external CDNs are unavailable. */
export function prepareRichContentAssets() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(import.meta.url);
  const source = path.join(path.dirname(require.resolve('@excalidraw/excalidraw')), 'fonts');
  const destination = path.join(root, 'public', 'vendor', 'excalidraw', 'fonts');
  if (!existsSync(destination)) { mkdirSync(destination, { recursive: true }); cpSync(source, destination, { recursive: true }); }

  // Bundle the official ESM engine as a classic script so an opaque-origin
  // sandbox can load local assets without granting same-origin document access.
  const plant = path.dirname(require.resolve('@plantuml/core/package.json'));
  const { version } = JSON.parse(readFileSync(path.join(plant, 'package.json'), 'utf8'));
  const output = path.join(root, 'public', 'vendor', 'plantuml', version);
  const frame = path.join(root, 'src/features/knowledge/editor/block-modules/rich-content/plantuml/renderer-frame.ts');
  const validation = path.join(path.dirname(frame), 'source.ts');
  const signature = createHash('sha256').update(version).update(readFileSync(fileURLToPath(import.meta.url))).update(readFileSync(frame)).update(readFileSync(validation)).digest('hex');
  const stamp = path.join(output, '.fob-build');
  if (!existsSync(stamp) || readFileSync(stamp, 'utf8') !== signature) {
    mkdirSync(output, { recursive: true });
    for (const name of ['viz-global.js', 'themes.js', 'emoji.js', 'openiconic.js', 'LICENSE']) cpSync(path.join(plant, name), path.join(output, name));
    buildSync({ entryPoints: [frame], outfile: path.join(output, 'renderer.js'), bundle: true, format: 'iife', platform: 'browser', target: 'es2020', minify: true, legalComments: 'eof', logLevel: 'warning' });
    writeFileSync(path.join(output, 'renderer.html'), `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Fob PlantUML renderer</title><script src="./viz-global.js" defer></script><script src="./renderer.js" defer></script></head><body></body></html>`);
    writeFileSync(stamp, signature);
  }
}
prepareRichContentAssets();

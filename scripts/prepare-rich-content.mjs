import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Fonts are served by Fob, including when external CDNs are unavailable. */
export function prepareRichContentAssets() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const require = createRequire(import.meta.url);
  const source = path.join(path.dirname(require.resolve('@excalidraw/excalidraw')), 'fonts');
  const destination = path.join(root, 'public', 'vendor', 'excalidraw', 'fonts');
  if (!existsSync(destination)) { mkdirSync(destination, { recursive: true }); cpSync(source, destination, { recursive: true }); }
}
prepareRichContentAssets();

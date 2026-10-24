/**
 * Client Boundary conformance tests (E03): the editor payload must only be
 * reachable through a client-only dynamic import. The flag module pins the
 * `ssr` decision as a named, importable fact; the source assertions keep the
 * boundary module honest (dynamic import of the container, no direct
 * Tiptap/prosemirror imports) and the tree scan keeps every other module on
 * the lazy path instead of reaching into the editor runtime directly.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'bun:test';
import { editorClientBoundary } from './editor-boundary-options';

const pathOf = (url: string) => fileURLToPath(new URL(url, import.meta.url));

describe('editorClientBoundary', () => {
  test('the editor never renders on the server', () => {
    expect(editorClientBoundary().ssr).toBe(false);
    expect(editorClientBoundary().loadingLabel.length).toBeGreaterThan(0);
  });

  test('the boundary module lazy-imports the container and stays chunk-clean', () => {
    const source = readFileSync(pathOf('./editor-boundary.tsx'), 'utf8');
    expect(source).toContain("import('./page-editor')");
    expect(source).toContain('ssr: editorClientBoundary().ssr');
    // Any direct editor-runtime import here would defeat the lazy boundary.
    expect(/from\s+['"]@tiptap\//.test(source)).toBe(false);
    expect(/from\s+['"]y-prosemirror['"]/.test(source)).toBe(false);
  });

  test('no module outside the editor reaches into its runtime directly', () => {
    const srcRoot = pathOf('../../..');
    const offenders: string[] = [];
    const walk = (directory: string) => {
      for (const entry of readdirSync(directory)) {
        const path = `${directory}/${entry}`;
        if (statSync(path).isDirectory()) {
          if (entry === 'editor' || entry === 'node_modules') continue;
          walk(path);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry) || entry.endsWith('.d.ts')) continue;
        const content = readFileSync(path, 'utf8');
        // The sanctioned entry is the index module (the boundary itself);
        // deep imports of the container or the surface would load the whole
        // editor runtime eagerly.
        if (/['"].*(?:\/editor\/page-editor|\/editor\/editor-surface)['"]/.test(content))
          offenders.push(path);
      }
    };
    walk(srcRoot);
    expect(offenders).toHaveLength(0);
  });
});

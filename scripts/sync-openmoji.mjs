/** Sync only Fob's reviewed 200-emoji subset; never install the complete OpenMoji library. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '17.0.0';
const upstream = `https://raw.githubusercontent.com/hfg-gmuend/openmoji/${version}`;
async function download(url) {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (attempt === 3) throw error;
      await delay(500 * (attempt + 1));
    }
  }
}
const groups = JSON.parse(await fs.readFile(path.join(root, 'src/components/icons/openmoji-catalog.json'), 'utf8'));
const items = groups.flatMap(group => group.items);
if (groups.length !== 8 || groups.some(group => group.items.length !== 25) || new Set(items.map(item => item.hexcode)).size !== 200) throw new Error('Review exactly 8 categories and 200 distinct emoji before syncing.');
const destination = path.join(root, 'public/icons/openmoji');
await fs.mkdir(destination, { recursive: true });
const manifest = { version, source: 'https://github.com/hfg-gmuend/openmoji', license: 'CC-BY-SA-4.0', icons: {} };
let cursor = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (cursor < items.length) {
    const item = items[cursor++];
    if (!/^[0-9A-F]+(?:-[0-9A-F]+)*$/.test(item.hexcode)) throw new Error('Invalid reviewed emoji code');
    const source = `${upstream}/color/svg/${item.hexcode}.svg`;
    const bytes = await download(source);
    const svg = bytes.toString('utf8');
    if (!svg.includes('<svg') || /<script|<foreignObject|\son\w+=|(?:href|src)=["']https?:/i.test(svg)) throw new Error(`Unexpected active content in ${item.hexcode}`);
    await fs.writeFile(path.join(destination, `${item.hexcode}.svg`), bytes);
    manifest.icons[item.hexcode] = { emoji: item.emoji, source, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
}));
manifest.icons = Object.fromEntries(Object.entries(manifest.icons).sort(([a],[b])=>a.localeCompare(b)));
await fs.writeFile(path.join(destination, 'sources.json'), JSON.stringify(manifest, null, 2) + '\n');
await fs.mkdir(path.join(root, 'public/licenses'), { recursive: true });
await fs.writeFile(path.join(root, 'public/licenses/openmoji.txt'), await download(`${upstream}/LICENSE.txt`));
console.log(`Synced ${items.length} original OpenMoji ${version} color SVGs; source hashes and CC-BY-SA attribution retained.`);

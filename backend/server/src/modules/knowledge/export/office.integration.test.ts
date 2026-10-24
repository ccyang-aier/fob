import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { officeExecutable, renderLegacyWord } from './office';
describe.skipIf(!existsSync(officeExecutable()))('real legacy Word rendering', () => {
  test('converts a two-page Word binary to searchable PDF without dropping the last page', async () => {
    const pdf = await renderLegacyWord(await readFile(new URL('./fixtures/word-preview.doc', import.meta.url)));
    const raw = new TextDecoder().decode(pdf);
    expect(raw.startsWith('%PDF-')).toBe(true);
    expect(raw.match(/\/Type\s*\/Page\b/g)).toHaveLength(2);
    expect(raw).toContain('/ToUnicode');
  }, 75_000);
});

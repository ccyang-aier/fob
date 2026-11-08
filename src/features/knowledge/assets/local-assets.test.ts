import { afterAll, beforeAll, expect, test } from 'bun:test';
import { IDBFactory } from 'fake-indexeddb';
import { localFolderFixture } from '@/test/local-folder-handle';
import { getLocalFolderSession } from '../local/local-folder-session';
import { readLocalAsset, saveLocalAsset, listLocalKnowledgeBaseAssets } from './local-assets';

const fixtures: Awaited<ReturnType<typeof localFolderFixture>>[] = [];
let picked: Awaited<ReturnType<typeof localFolderFixture>>;
beforeAll(() => {
  Object.assign(globalThis, { indexedDB: new IDBFactory(), window: { isSecureContext: true, localStorage: { removeItem() {} }, addEventListener() {}, showDirectoryPicker: async () => picked.handle } });
});
afterAll(async () => { for (const fixture of fixtures) await fixture.cleanup(); });
async function open(name: string) {
  picked = await localFolderFixture(); fixtures.push(picked);
  return getLocalFolderSession().open(name);
}
test('original attachment bytes are written to each chosen folder and deletion stays scoped', async () => {
  const file = new File(['scoped attachment'], 'research.txt', { type: 'text/plain' });
  const a = await open('A'), source = await saveLocalAsset(a.id, file), b = await open('B');
  await saveLocalAsset(b.id, file);
  expect(await (await readLocalAsset(a.id, source))?.blob.text()).toBe('scoped attachment');
  expect((await listLocalKnowledgeBaseAssets(a.id)).map(asset => asset.name)).toEqual(['research.txt']);
  await getLocalFolderSession().remove(a.id);
  expect((await readLocalAsset(b.id, source))?.name).toBe('research.txt');
  expect(await (await readLocalAsset(b.id, source))?.blob.text()).toBe('scoped attachment');
  expect(() => getLocalFolderSession().getDirectory(a.id)).toThrow();
});

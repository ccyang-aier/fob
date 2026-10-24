import { beforeAll, expect, test } from 'bun:test';
import { IDBFactory, IDBKeyRange } from 'fake-indexeddb';
import { readLocalAsset, removeLocalKnowledgeBaseAssets, saveLocalAsset } from './local-assets';

beforeAll(() => { Object.assign(globalThis, { indexedDB: new IDBFactory(), IDBKeyRange }); });

test('deleting a local knowledge workspace removes only its asset bytes', async () => {
  const file = new File(['scoped attachment'], 'research.txt', { type: 'text/plain' });
  const source = await saveLocalAsset('base-a', file);
  await saveLocalAsset('base-a-extra', file);
  expect(await readLocalAsset('base-a', source)).not.toBeNull();
  await removeLocalKnowledgeBaseAssets('base-a');
  expect(await readLocalAsset('base-a', source)).toBeNull();
  expect((await readLocalAsset('base-a-extra', source))?.name).toBe('research.txt');
});

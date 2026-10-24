import { expect, test } from 'bun:test';
import { createDevelopmentKnowledgeBases } from './development-workbench';

test('independent development bases exercise diverse content and empty states', () => {
  const bases = createDevelopmentKnowledgeBases();
  expect(bases).toHaveLength(12);
  expect(bases.filter((base) => base.documents.length === 0)).toHaveLength(3);
  const ids = new Set<string>();
  const extensions = new Set<string>();
  let documents = 0;
  for (const base of bases) {
    expect(ids.has(base.id)).toBe(false); ids.add(base.id);
    for (const folder of base.folders) {
      expect(ids.has(folder.id)).toBe(false); ids.add(folder.id);
      expect(folder.knowledgeBaseId).toBe(base.id);
    }
    for (const document of base.documents) {
      expect(ids.has(document.id)).toBe(false); ids.add(document.id);
      expect(document.knowledgeBaseId).toBe(base.id);
      expect(base.folders.some((folder) => folder.id === document.folderId)).toBe(true);
      extensions.add(document.title.split('.').at(-1)!); documents++;
    }
  }
  expect(documents).toBe(145);
  expect(extensions.size).toBeGreaterThanOrEqual(10);
});

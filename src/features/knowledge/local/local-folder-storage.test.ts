import { afterEach, expect, test } from 'bun:test';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { localFolderFixture } from '@/test/local-folder-handle';
import { LocalFolderStorage } from './local-folder-storage';
import { newLocalDocument } from './local-library';
import { localTemplateSnapshot } from '../templates/local-templates';

const fixtures: Awaited<ReturnType<typeof localFolderFixture>>[] = [];
async function fixture() { const value = await localFolderFixture(); fixtures.push(value); return value; }
afterEach(async () => { for (const value of fixtures.splice(0)) await value.cleanup(); });

test('a chosen folder preserves bodies, hierarchy, metadata and independent templates across reopening', async () => {
  const { handle, root } = await fixture();
  const { storage, library } = await LocalFolderStorage.create(handle, 'My research');
  const baseId = storage.baseId, folderId = crypto.randomUUID();
  const document = { ...newLocalDocument(baseId, 'Finding'), folderId, body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Persistent knowledge' }] }] } };
  library.folders.push({ id: folderId, knowledgeBaseId: baseId, name: 'Research', metadata: { revision: 1, description: document.body } });
  library.documents.push(document); library.templates = [localTemplateSnapshot(document, 'Brief', '')];
  await storage.save(library);
  const reopened = await LocalFolderStorage.open(handle);
  expect(reopened.library).toEqual(library);
  expect(await readdir(root)).toContain('knowledge-base.json');
  const manifest = JSON.parse(await readFile(path.join(root, 'knowledge-base.json'), 'utf8'));
  expect(manifest.documents).toHaveLength(1); expect(manifest.templates).toHaveLength(1);
  document.body.content[0].content[0].text = 'Latest';
  await storage.save(library);
  expect((await LocalFolderStorage.open(handle)).library.documents[0].body).toEqual(document.body);
  expect(await readdir(path.join(root, 'documents'))).toHaveLength(1);
});

test('an interrupted manifest write leaves the previous complete body readable and can be retried', async () => {
  const { handle, control } = await fixture(), { storage, library } = await LocalFolderStorage.create(handle, 'Durable');
  library.documents.push(newLocalDocument(storage.baseId, 'Before')); await storage.save(library);
  const previous = structuredClone(library);
  library.documents[0].title = 'After'; control.failWrite = 'knowledge-base.json';
  await expect(storage.save(library)).rejects.toThrow('Disk write failed');
  expect((await LocalFolderStorage.open(handle)).library).toEqual(previous);
  control.failWrite = ''; await storage.save(library);
  expect((await LocalFolderStorage.open(handle)).library.documents[0].title).toBe('After');
});

test('another writer cannot overwrite a newer revision', async () => {
  const { handle } = await fixture(), first = await LocalFolderStorage.create(handle, 'Concurrent');
  const second = await LocalFolderStorage.open(handle);
  first.library.documents.push(newLocalDocument(first.storage.baseId, 'First writer')); await first.storage.save(first.library);
  second.library.documents.push(newLocalDocument(second.storage.baseId, 'Stale writer'));
  await expect(second.storage.save(second.library)).rejects.toThrow();
  expect((await LocalFolderStorage.open(handle)).library.documents[0].title).toBe('First writer');
});

test('retry repairs an empty content entry left by an aborted first write before publishing its reference', async () => {
  const { handle, control } = await fixture(), { storage, library } = await LocalFolderStorage.create(handle, 'Content retry');
  library.documents.push(newLocalDocument(storage.baseId, 'Complete body'));
  control.failWrite = '.json';
  await expect(storage.save(library)).rejects.toThrow();
  expect((await LocalFolderStorage.open(handle)).library.documents).toEqual([]);
  control.failWrite = ''; await storage.save(library);
  expect((await LocalFolderStorage.open(handle)).library.documents[0].title).toBe('Complete body');
});

test('corrupt hashes, path traversal and foreign knowledge ownership are rejected', async () => {
  const { handle, root } = await fixture(), { storage, library } = await LocalFolderStorage.create(handle, 'Checked');
  library.documents.push(newLocalDocument(storage.baseId, 'Original')); await storage.save(library);
  const manifestPath = path.join(root, 'knowledge-base.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  await writeFile(path.join(root, 'documents', manifest.documents[0]), '{}');
  await expect(LocalFolderStorage.open(handle)).rejects.toThrow();
  manifest.documents = ['../outside.json']; await writeFile(manifestPath, JSON.stringify(manifest));
  await expect(LocalFolderStorage.open(handle)).rejects.toThrow();
  library.documents[0].baseId = crypto.randomUUID();
  await expect(storage.save(library)).rejects.toThrow();
});

test('creation refuses occupied folders and deletion preserves unrelated user files', async () => {
  const { handle, root } = await fixture();
  const { storage, library } = await LocalFolderStorage.create(handle, 'Delete');
  library.documents.push(newLocalDocument(storage.baseId, 'Deleted')); await storage.save(library);
  await writeFile(path.join(root, 'documents', 'my-notes.txt'), 'Keep me');
  await writeFile(path.join(root, 'personal.txt'), 'Keep this too');
  await expect(LocalFolderStorage.create(handle, 'Overwrite')).rejects.toThrow();
  await storage.remove();
  expect(await readFile(path.join(root, 'documents', 'my-notes.txt'), 'utf8')).toBe('Keep me');
  expect(await readFile(path.join(root, 'personal.txt'), 'utf8')).toBe('Keep this too');
  expect(await readdir(root)).not.toContain('knowledge-base.json');
});

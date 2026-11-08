import { z } from 'zod';
import { createTranslator } from '@/lib/i18n';
import type { LocalDocument, LocalLibrary } from './local-library';
import type { KnowledgeTemplateDetail } from '@fob/shared/knowledge/templates';
import { messages } from './local-folder.messages';

const t = createTranslator(messages);
const manifestName = 'knowledge-base.json';
const contentName = /^[a-f0-9]{64}\.json$/;
const id = z.uuid();
const body = z.object({ type: z.literal('doc'), content: z.array(z.unknown()).optional() }).loose();
const baseSchema = z.object({ id, name: z.string().trim().min(1).max(120), learningSeconds: z.number().int().nonnegative().optional(), convertedTo: z.object({ id, principal: z.string() }).optional() });
const manifestSchema = z.object({
  format: z.literal('fob-local-knowledge-base'), version: z.literal(1), revision: id,
  base: baseSchema,
  folders: z.array(z.object({ id, knowledgeBaseId: id, name: z.string(), parentId: id.nullable().optional(), metadata: z.record(z.string(), z.unknown()).optional() })),
  tags: z.array(z.object({ id, baseId: id, name: z.string(), pageIds: z.array(id) })),
  documents: z.array(z.string().regex(contentName)), templates: z.array(z.string().regex(contentName)),
});
const documentSchema = z.object({ id, baseId: id, title: z.string(), body, folderId: id.optional(), starred: z.boolean(), draft: z.boolean(), deleted: z.boolean(), updatedAt: z.string() }).loose();
const templateSchema = z.object({ template: z.object({ id, knowledgeBaseId: id, sourcePageId: id, name: z.string(), title: z.string() }).loose(), document: body });
type Manifest = z.infer<typeof manifestSchema>;

/** Explicitly chosen user directory; OPFS and browser content databases are never used. */
export interface LocalDirectoryHandle extends FileSystemDirectoryHandle {
  queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>;
}

export function supportsLocalFolders() {
  return typeof window !== 'undefined' && window.isSecureContext && 'showDirectoryPicker' in window;
}
export function pickLocalFolder(): Promise<LocalDirectoryHandle> {
  if (!supportsLocalFolders()) return Promise.reject(new Error(t('unsupported')));
  return (window as unknown as { showDirectoryPicker(options: { mode: 'readwrite'; id: string }): Promise<LocalDirectoryHandle> })
    .showDirectoryPicker({ mode: 'readwrite', id: 'fob-local-knowledge-base' });
}
export async function requireFolderPermission(handle: LocalDirectoryHandle, request = false) {
  const options = { mode: 'readwrite' } as const;
  if (await handle.queryPermission(options) === 'granted') return true;
  return request && await handle.requestPermission(options) === 'granted';
}
export async function writeLocalFile(directory: FileSystemDirectoryHandle, name: string, data: string | Blob) {
  const file = await directory.getFileHandle(name, { create: true });
  const stream = await file.createWritable();
  try { await stream.write(data); await stream.close(); }
  catch (cause) { await stream.abort().catch(() => {}); throw cause; }
}
async function digest(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
async function readManifest(handle: FileSystemDirectoryHandle): Promise<Manifest> {
  try { return manifestSchema.parse(JSON.parse(await (await handle.getFileHandle(manifestName)).getFile().then(file => file.text()))); }
  catch (cause) { if (cause instanceof DOMException && cause.name === 'NotAllowedError') throw cause; throw new Error(t('invalid')); }
}
async function readContents<T>(handle: FileSystemDirectoryHandle, folder: string, names: string[], parse: (value: unknown) => T): Promise<T[]> {
  if (!names.length) return [];
  const directory = await handle.getDirectoryHandle(folder);
  return Promise.all(names.map(async name => {
    const text = await (await directory.getFileHandle(name)).getFile().then(file => file.text());
    if (`${await digest(text)}.json` !== name) throw new Error(t('invalid'));
    return parse(JSON.parse(text));
  }));
}
export function libraryForBase(library: LocalLibrary, baseId: string): LocalLibrary {
  return { bases: library.bases.filter(base => base.id === baseId), folders: library.folders.filter(folder => folder.knowledgeBaseId === baseId), documents: library.documents.filter(document => document.baseId === baseId), tags: library.tags.filter(tag => tag.baseId === baseId), templates: library.templates?.filter(item => item.template.knowledgeBaseId === baseId) ?? [] };
}
function validateRelations(library: LocalLibrary) {
  const baseId = library.bases[0]?.id;
  const folders = new Set(library.folders.map(folder => folder.id));
  const documents = new Set(library.documents.map(document => document.id));
  if (!baseId || library.bases.length !== 1 || folders.size !== library.folders.length || documents.size !== library.documents.length ||
    library.folders.some(folder => folder.knowledgeBaseId !== baseId || (folder.parentId && !folders.has(folder.parentId))) ||
    library.documents.some(document => document.baseId !== baseId || (document.folderId && !folders.has(document.folderId))) ||
    library.tags.some(tag => tag.baseId !== baseId) || library.templates?.some(item => item.template.knowledgeBaseId !== baseId)) throw new Error(t('invalid'));
  for (const folder of library.folders) {
    const seen = new Set([folder.id]);
    let parent = folder.parentId;
    while (parent) { if (seen.has(parent)) throw new Error(t('invalid')); seen.add(parent); parent = library.folders.find(item => item.id === parent)?.parentId; }
  }
}

export class LocalFolderStorage {
  private verifiedFiles = new Set<string>();
  constructor(readonly handle: LocalDirectoryHandle, public revision: string, readonly baseId: string) {}
  static async create(handle: LocalDirectoryHandle, name: string) {
    for await (const _entry of handle.entries()) { void _entry; throw new Error(t('notEmpty')); }
    const library: LocalLibrary = { bases: [{ id: crypto.randomUUID(), name }], folders: [], documents: [], tags: [], templates: [] };
    const storage = new LocalFolderStorage(handle, '', library.bases[0].id);
    await storage.save(library);
    return { storage, library };
  }
  static async open(handle: LocalDirectoryHandle) {
    const initial = await readManifest(handle);
    const read = async () => {
      const manifest = await readManifest(handle);
      if (manifest.base.id !== initial.base.id) throw new Error(t('invalid'));
      const storage = new LocalFolderStorage(handle, manifest.revision, manifest.base.id);
      return { storage, library: await storage.load(manifest) };
    };
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`fob.local-folder.${initial.base.id}`, read);
    return read();
  }
  async load(manifest?: Manifest): Promise<LocalLibrary> {
    const current = manifest ?? await readManifest(this.handle);
    if (current.base.id !== this.baseId) throw new Error(t('invalid'));
    const [documents, templates] = await Promise.all([
      readContents(this.handle, 'documents', current.documents, value => documentSchema.parse(value) as unknown as LocalDocument),
      readContents(this.handle, 'templates', current.templates, value => templateSchema.parse(value) as unknown as KnowledgeTemplateDetail),
    ]);
    const library = { bases: [current.base], folders: current.folders, documents, tags: current.tags, templates } as LocalLibrary;
    validateRelations(library);
    return library;
  }
  async assertUnchanged() {
    if ((await readManifest(this.handle)).revision !== this.revision) throw new Error(t('conflict'));
  }
  async save(library: LocalLibrary) {
    validateRelations(library);
    if (library.bases[0].id !== this.baseId) throw new Error(t('invalid'));
    const commit = async () => {
      if (this.revision) await this.assertUnchanged();
      const writeContents = async (name: string, values: unknown[]) => {
        if (!values.length) return [];
        const directory = await this.handle.getDirectoryHandle(name, { create: true });
        return Promise.all(values.map(async value => {
          const text = JSON.stringify(value), name = `${await digest(text)}.json`;
          const key = `${directory.name}/${name}`;
          // Immutable content files let an interrupted multi-file save retain the previous manifest.
          if (!this.verifiedFiles.has(key)) {
            let existing: string | null = null;
            try { existing = await (await directory.getFileHandle(name)).getFile().then(file => file.text()); }
            catch (cause) { if (!(cause instanceof DOMException) || cause.name !== 'NotFoundError') throw cause; }
            // An aborted first write may leave an empty directory entry. Existence alone is insufficient.
            if (existing !== text) await writeLocalFile(directory, name, text);
            this.verifiedFiles.add(key);
          }
          return name;
        }));
      };
      const [documents, templates] = await Promise.all([writeContents('documents', library.documents), writeContents('templates', library.templates ?? [])]);
      const manifest: Manifest = { format: 'fob-local-knowledge-base', version: 1, revision: crypto.randomUUID(), base: library.bases[0], folders: library.folders, tags: library.tags, documents, templates };
      // Only publish the new revision after every content file has closed successfully.
      await writeLocalFile(this.handle, manifestName, JSON.stringify(manifest, null, 2));
      this.revision = manifest.revision;
      await Promise.all([this.prune('documents', new Set(documents)), this.prune('templates', new Set(templates))]);
    };
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`fob.local-folder.${this.baseId}`, commit);
    else await commit();
  }
  private async prune(folder: string, keep: Set<string>) {
    try {
      const directory = await this.handle.getDirectoryHandle(folder) as LocalDirectoryHandle;
      for await (const [name, entry] of directory.entries()) if (entry.kind === 'file' && contentName.test(name) && !keep.has(name)) {
        await directory.removeEntry(name); this.verifiedFiles.delete(`${folder}/${name}`);
      }
    } catch { /* Committed data remains durable; orphan cleanup can be retried by a later save. */ }
  }
  async remove() {
    const remove = async () => {
      await this.assertUnchanged();
      for (const folder of ['documents', 'templates', 'assets']) {
        let directory: LocalDirectoryHandle;
        try { directory = await this.handle.getDirectoryHandle(folder) as LocalDirectoryHandle; }
        catch (cause) { if (cause instanceof DOMException && cause.name === 'NotFoundError') continue; throw cause; }
        for await (const [name, entry] of directory.entries()) if (entry.kind === 'file' && /^[a-f0-9]{64}(?:\.json)?$/.test(name)) await directory.removeEntry(name);
        try { await this.handle.removeEntry(folder); } catch (cause) { if (!(cause instanceof DOMException) || cause.name !== 'InvalidModificationError') throw cause; }
      }
      await this.handle.removeEntry(manifestName);
    };
    if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request(`fob.local-folder.${this.baseId}`, remove);
    else await remove();
  }
}

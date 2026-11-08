'use client';

import { createTranslator } from '@/lib/i18n';
import { createLocalLibraryStore, emptyLocalLibrary, type LocalLibrary } from './local-library';
import { libraryForBase, LocalFolderStorage, pickLocalFolder, requireFolderPermission, type LocalDirectoryHandle } from './local-folder-storage';
import { clearRetiredBrowserLibraries } from './retired-browser-library';
import { messages } from './local-folder.messages';

const t = createTranslator(messages);
type FolderState = { name: string; state: 'ready' | 'permission' | 'error'; pending: boolean; error: string | null };
type SessionState = { ready: boolean; error: string | null; recentError: boolean; folders: Record<string, FolderState> };
type RecentFolder = { id: string; handle: LocalDirectoryHandle };

async function recentFolders<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fob-local-folders', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('handles', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction('handles', mode), request = action(tx.objectStore('handles'));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
export class LocalFolderSession {
  private state: SessionState = { ready: false, error: null, recentError: false, folders: {} };
  private listeners = new Set<() => void>();
  private folders = new Map<string, { handle: LocalDirectoryHandle; storage?: LocalFolderStorage; saved?: string }>();
  private dirty = new Set<string>();
  private running: Promise<void> | null = null;
  private initializing: Promise<void> | undefined;
  readonly store = createLocalLibraryStore({ save: next => this.queue(next) });
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.state;
  private publish(patch: Partial<SessionState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(listener => listener()); }
  private setFolder(id: string, patch: Partial<FolderState>) { this.publish({ folders: { ...this.state.folders, [id]: { ...this.state.folders[id], ...patch } } }); }
  initialize() { return this.initializing ??= this.start(); }
  restart() { this.initializing = undefined; this.publish({ ready: false, error: null }); return this.initialize(); }
  private async start() {
    try { await clearRetiredBrowserLibraries(); }
    catch { this.publish({ ready: true, error: t('cleanupFailed') }); return; }
    try {
      const recent = await recentFolders('readonly', store => store.getAll()) as RecentFolder[];
      for (const { id, handle } of recent) {
        this.folders.set(id, { handle });
        this.setFolder(id, { name: handle.name, state: 'permission', pending: false, error: null });
        this.install({ ...emptyLocalLibrary, bases: [{ id, name: handle.name }] });
        try { if (await requireFolderPermission(handle)) await this.load(id); }
        catch (cause) { this.setFolder(id, { state: 'error', error: cause instanceof Error ? cause.message : t('denied') }); }
      }
    } catch { this.publish({ recentError: true }); }
    this.publish({ ready: true });
    window.addEventListener('beforeunload', event => {
      if (this.dirty.size || Object.values(this.state.folders).some(folder => folder.pending || folder.error)) { event.preventDefault(); event.returnValue = ''; }
    });
  }
  private install(library: LocalLibrary) {
    const ids = new Set(library.bases.map(base => base.id)), current = this.store.getSnapshot();
    this.store.replace({ bases: [...current.bases.filter(base => !ids.has(base.id)), ...library.bases], folders: [...current.folders.filter(folder => !ids.has(folder.knowledgeBaseId)), ...library.folders], documents: [...current.documents.filter(document => !ids.has(document.baseId)), ...library.documents], tags: [...current.tags.filter(tag => !ids.has(tag.baseId)), ...library.tags], templates: [...(current.templates ?? []).filter(item => !ids.has(item.template.knowledgeBaseId)), ...(library.templates ?? [])] });
  }
  private async remember(id: string) {
    try { await recentFolders('readwrite', store => store.put({ id, handle: this.folders.get(id)!.handle } satisfies RecentFolder)); }
    catch { this.publish({ recentError: true }); }
  }
  private async load(id: string) {
    const entry = this.folders.get(id)!;
    const { storage, library } = await LocalFolderStorage.open(entry.handle);
    if (storage.baseId !== id) throw new Error(t('invalid'));
    entry.storage = storage; entry.saved = JSON.stringify(library);
    this.install(library);
    this.setFolder(id, { state: 'ready', error: null });
  }
  async open(name?: string) {
    // The picker must run before any asynchronous work to preserve the click's user activation.
    const handle = await pickLocalFolder();
    await this.initialize();
    if (this.state.error) throw new Error(this.state.error);
    if (!await requireFolderPermission(handle, true)) throw new Error(t('denied'));
    const result = name ? await LocalFolderStorage.create(handle, name) : await LocalFolderStorage.open(handle);
    const { storage, library } = result, id = storage.baseId;
    const previous = this.folders.get(id);
    if (previous) {
      if (!await previous.handle.isSameEntry(handle)) throw new Error(t('conflict'));
      await this.flush(id);
      await this.load(id);
      // Reopening the same directory must not replace unsaved edits.
      return this.store.getSnapshot().bases.find(base => base.id === id)!;
    }
    this.folders.set(id, { handle, storage, saved: JSON.stringify(library) });
    this.setFolder(id, { name: handle.name, state: 'ready', pending: false, error: null });
    this.install(library);
    await this.remember(id);
    return library.bases[0];
  }
  async authorize(id: string) {
    const entry = this.folders.get(id);
    if (!entry || !await requireFolderPermission(entry.handle, true)) throw new Error(t('denied'));
    if (this.dirty.has(id)) { await this.retry(id); return; }
    await this.load(id);
  }
  getDirectory(id: string) {
    const entry = this.folders.get(id);
    if (!entry?.storage || this.state.folders[id]?.state !== 'ready') throw new Error(t('denied'));
    return entry.handle;
  }
  private queue(next: LocalLibrary) {
    const previous = this.store.getSnapshot();
    const changed = next.bases.filter(base => JSON.stringify(libraryForBase(previous, base.id)) !== JSON.stringify(libraryForBase(next, base.id))).map(base => base.id);
    if (previous.bases.some(base => !next.bases.some(item => item.id === base.id))) throw new Error(t('denied'));
    for (const id of changed) this.getDirectory(id);
    for (const id of changed) { this.dirty.add(id); this.setFolder(id, { pending: true }); }
    // Coalesce synchronous operations; the in-memory snapshot is published before disk IO starts.
    queueMicrotask(() => { void this.drain(); });
  }
  private drain(): Promise<void> {
    if (this.running) return this.running;
    const run = async () => {
      for (const id of [...this.dirty]) {
        const entry = this.folders.get(id);
        if (!entry?.storage) continue;
        try {
          while (this.dirty.has(id)) {
            this.dirty.delete(id);
            const library = libraryForBase(this.store.getSnapshot(), id), text = JSON.stringify(library);
            if (text !== entry.saved) await entry.storage.save(library);
            entry.saved = text;
          }
          this.setFolder(id, { pending: false, error: null });
        } catch (cause) {
          this.dirty.add(id);
          this.setFolder(id, { pending: false, error: cause instanceof Error ? cause.message : t('denied') });
        }
      }
    };
    this.running = run().finally(() => {
      this.running = null;
      if ([...this.dirty].some(id => !this.state.folders[id]?.error)) queueMicrotask(() => { void this.drain(); });
    });
    return this.running;
  }
  async flush(id?: string) {
    await this.drain();
    // A different folder can become dirty while an earlier save is running.
    if ([...this.dirty].some(key => !this.state.folders[key]?.error)) await this.drain();
    const failed = id ? this.state.folders[id] : Object.values(this.state.folders).find(folder => folder.error);
    if (failed?.error) throw new Error(failed.error);
  }
  async retry(id: string) {
    const entry = this.folders.get(id);
    if (!entry || !await requireFolderPermission(entry.handle, true)) throw new Error(t('denied'));
    this.dirty.add(id); this.setFolder(id, { pending: true, error: null });
    await this.flush(id);
  }
  async unchanged(id: string) { await this.flush(id); await this.folders.get(id)?.storage?.assertUnchanged(); }
  async remove(id: string) {
    await this.flush(id);
    const entry = this.folders.get(id);
    if (!entry?.storage) throw new Error(t('denied'));
    await entry.storage.remove();
    try { await recentFolders('readwrite', store => store.delete(id)); } catch { this.publish({ recentError: true }); }
    this.folders.delete(id); this.dirty.delete(id);
    const current = this.store.getSnapshot();
    this.store.replace({ bases: current.bases.filter(base => base.id !== id), folders: current.folders.filter(folder => folder.knowledgeBaseId !== id), documents: current.documents.filter(document => document.baseId !== id), tags: current.tags.filter(tag => tag.baseId !== id), templates: current.templates?.filter(item => item.template.knowledgeBaseId !== id) });
    const folders = { ...this.state.folders }; delete folders[id]; this.publish({ folders });
  }
}

let session: LocalFolderSession | undefined;
export function getLocalFolderSession() { return session ??= new LocalFolderSession(); }

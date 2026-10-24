'use client';

type SessionStatus = { ready: boolean; error: Error | null };
type Row = { scope: string; key: string; value: unknown };
const sessions = new Map<string, ProjectUiSession>();
let database: IDBDatabase | undefined;
let opening: Promise<IDBDatabase> | undefined;

function openDatabase() {
  if (database) return Promise.resolve(database);
  return opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('fob-ui-sessions', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('values', { keyPath: ['scope', 'key'] }).createIndex('scope', 'scope');
    request.onerror = () => { opening = undefined; reject(request.error); };
    request.onsuccess = () => {
      database = request.result;
      database.onversionchange = () => { database?.close(); database = undefined; opening = undefined; };
      resolve(database);
    };
  });
}

/** Only device UI state lives here; feature owners choose their own keys and values. */
export class ProjectUiSession {
  private values = new Map<string, unknown>();
  private listeners = new Set<() => void>();
  private pending: Array<() => void> = [];
  private status: SessionStatus = { ready: false, error: null };
  readonly loaded: Promise<void>;
  constructor(readonly scope: string) {
    this.loaded = this.load();
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getStatus = () => this.status;
  private publish() { this.listeners.forEach(listener => listener()); }
  get<T>(key: string, fallback: T): T { return this.values.has(key) ? this.values.get(key) as T : fallback; }
  private fail(cause: unknown) {
    this.status = { ...this.status, error: cause instanceof Error ? cause : new Error(String(cause)) };
    this.publish();
  }
  private async load() {
    try {
      if (typeof indexedDB !== 'undefined') {
        const db = await openDatabase();
        const rows = await new Promise<Row[]>((resolve, reject) => {
          const request = db.transaction('values').objectStore('values').index('scope').getAll(this.scope);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        for (const row of rows) if (typeof row.key === 'string') this.values.set(row.key, row.value);
      }
    } catch (cause) { this.fail(cause); }
    this.status = { ...this.status, ready: true };
    this.pending.splice(0).forEach(change => change());
    this.publish();
  }
  set<T>(key: string, change: T | ((current: T) => T), fallback: T) {
    if (!this.status.ready) { this.pending.push(() => this.set(key, change, fallback)); return; }
    const current = this.get(key, fallback);
    const next = typeof change === 'function' ? (change as (value: T) => T)(current) : change;
    if (this.values.has(key) && Object.is(current, next)) return;
    this.values.set(key, next);
    this.write(key, next);
    this.publish();
  }
  private write(key: string, value: unknown) {
    if (!database) return;
    try {
      const transaction = database.transaction('values', 'readwrite');
      transaction.objectStore('values').put({ scope: this.scope, key, value } satisfies Row);
      transaction.onerror = () => this.fail(transaction.error);
    } catch (cause) { this.fail(cause); }
  }
  copyPage(from: number, to: number) {
    const prefix = `page:${from}:`;
    try {
      const copies = [...this.values].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => [`page:${to}:${key.slice(prefix.length)}`, structuredClone(value)] as const);
      copies.forEach(([key, value]) => { this.values.set(key, value); this.write(key, value); });
      this.publish();
      return true;
    } catch (cause) { this.fail(cause); return false; }
  }
  retainPages(instances: readonly number[]) {
    const retained = new Set(instances);
    const keys = [...this.values.keys()].filter(key => { const id = /^page:(\d+):/.exec(key)?.[1]; return id !== undefined && !retained.has(Number(id)); });
    keys.forEach(key => this.values.delete(key));
    if (!database || !keys.length) return;
    try {
      const transaction = database.transaction('values', 'readwrite');
      keys.forEach(key => transaction.objectStore('values').delete([this.scope, key]));
      transaction.onerror = () => this.fail(transaction.error);
    } catch (cause) { this.fail(cause); }
  }
}

export function getProjectUiSession(scope: string) {
  let session = sessions.get(scope);
  if (!session) { session = new ProjectUiSession(scope); sessions.set(scope, session); }
  return session;
}

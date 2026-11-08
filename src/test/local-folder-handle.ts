import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { LocalDirectoryHandle } from '../features/knowledge/local/local-folder-storage';

/** Browser file handle contract backed by real, isolated disk files for durability tests. */
export async function localFolderFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fob-local-folder-'));
  const control = { permission: 'granted' as PermissionState, failWrite: '', pause: undefined as Promise<void> | undefined };
  const checked = (parent: string, name: string) => {
    if (!name || name === '.' || name === '..' || /[\\/]/.test(name)) throw new Error('Invalid test file name');
    return path.join(parent, name);
  };
  const inspect = async (target: string, create: boolean, kind: 'file' | 'directory') => {
    if (control.permission !== 'granted') throw new DOMException('Permission denied', 'NotAllowedError');
    try {
      const value = await stat(target);
      if ((kind === 'directory') !== value.isDirectory()) throw new DOMException('Wrong kind', 'TypeMismatchError');
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause;
      if (!create) throw new DOMException('Missing file', 'NotFoundError');
      if (kind === 'directory') await mkdir(target); else await writeFile(target, '');
    }
  };
  const directory = (target: string): LocalDirectoryHandle => ({
    kind: 'directory', name: path.basename(target),
    queryPermission: async () => control.permission,
    requestPermission: async () => control.permission,
    isSameEntry: async (other: FileSystemHandle) => (other as unknown as { testPath: string }).testPath === target,
    testPath: target,
    async *entries() {
      for (const entry of await readdir(target, { withFileTypes: true })) yield [entry.name, { kind: entry.isDirectory() ? 'directory' : 'file', name: entry.name }];
    },
    async getDirectoryHandle(name: string, options?: { create?: boolean }) {
      const next = checked(target, name); await inspect(next, options?.create ?? false, 'directory'); return directory(next);
    },
    async getFileHandle(name: string, options?: { create?: boolean }) {
      const next = checked(target, name); await inspect(next, options?.create ?? false, 'file');
      return { kind: 'file', name,
        getFile: async () => new File([await readFile(next)], name),
        createWritable: async () => {
          let data: string | Blob = '';
          return {
            write: async (value: string | Blob) => { data = value; },
            close: async () => {
              await control.pause;
              if (control.permission !== 'granted' || (control.failWrite && next.endsWith(control.failWrite))) throw new DOMException('Disk write failed', 'NotAllowedError');
              await writeFile(next, typeof data === 'string' ? data : new Uint8Array(await data.arrayBuffer()));
            },
            abort: async () => {},
          };
        },
      } as unknown as FileSystemFileHandle;
    },
    async removeEntry(name: string) {
      const next = checked(target, name); await inspect(next, false, (await stat(next)).isDirectory() ? 'directory' : 'file');
      try { await rm(next, { recursive: false }); }
      catch (cause) { if ((cause as NodeJS.ErrnoException).code === 'ERR_FS_EISDIR') {
        const { rmdir } = await import('node:fs/promises');
        try { await rmdir(next); } catch { throw new DOMException('Directory is not empty', 'InvalidModificationError'); }
      } else throw cause; }
    },
  } as unknown as LocalDirectoryHandle);
  return { root, handle: directory(root), control, async cleanup() {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(root).startsWith('fob-local-folder-')) throw new Error('Unsafe fixture cleanup');
    await rm(root, { recursive: true, force: true });
  } };
}

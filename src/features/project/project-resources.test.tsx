import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, StrictMode, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Project } from '@fob/shared/projects';
import type { useProjectResources as ReadResources } from './project-resources';

type ResourceState = ReturnType<typeof ReadResources>;
type Session = { status: 'anonymous' } | { status: 'authenticated'; user: { id: string } };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

let browser: Window;
let root: Root;
let resources: ResourceState;
let session: Session;
let listRequests: ReturnType<typeof deferred<Project[]>>[];
let pendingCreate: ReturnType<typeof deferred<Project>> | null;
let pendingRename: ReturnType<typeof deferred<Project>> | null;
let pendingRemove: ReturnType<typeof deferred<void>> | null;
let createFailure: Error | null;
let renameFailure: Error | null;
let removeFailure: Error | null;
let mutationCalls: { create: number; rename: number; remove: number };
let renderResources: () => ReactNode;

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of ['document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Event', 'MutationObserver', 'getComputedStyle', 'localStorage']) {
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  }
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  mock.module('@/features/identity/identity-provider', () => ({ useIdentity: () => ({ session }) }));
  mock.module('./project-client', () => ({ projectClient: {
    // Intentionally ignore abort: the provider must also reject stale results.
    list: () => { const request = deferred<Project[]>(); listRequests.push(request); return request.promise; },
    create: async (name: string) => {
      mutationCalls.create++;
      if (createFailure) throw createFailure;
      return pendingCreate ? pendingCreate.promise : { id: 'created-cloud', name };
    },
    rename: async (id: string, name: string) => {
      mutationCalls.rename++;
      if (renameFailure) throw renameFailure;
      return pendingRename ? pendingRename.promise : { id, name };
    },
    remove: async () => {
      mutationCalls.remove++;
      if (removeFailure) throw removeFailure;
      if (pendingRemove) await pendingRemove.promise;
    },
  } }));
  const { ProjectResourceProvider, useProjectResources } = await import('./project-resources');
  function Capture() {
    const value = useProjectResources();
    useEffect(() => { resources = value; }, [value]);
    return null;
  }
  renderResources = () => <ProjectResourceProvider><Capture /></ProjectResourceProvider>;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

beforeEach(async () => {
  await act(async () => root.render(null));
  localStorage.clear();
  session = { status: 'anonymous' };
  listRequests = [];
  pendingCreate = pendingRename = null;
  pendingRemove = null;
  createFailure = renameFailure = removeFailure = null;
  mutationCalls = { create: 0, rename: 0, remove: 0 };
});

afterAll(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
});

const localProjects = [{ id: 'local-a', name: '本机 A' }, { id: 'local-b', name: '本机 B' }];
function seedLocal(projects: Project[] = localProjects) { localStorage.setItem('fob.local-projects', JSON.stringify(projects)); }
async function render(strict = false) {
  await act(async () => {
    root.render(strict ? <StrictMode>{renderResources()}</StrictMode> : renderResources());
  });
}
async function switchUser(id: string | null) {
  session = id ? { status: 'authenticated', user: { id } } : { status: 'anonymous' };
  await render();
}
async function publish(projects: Project[], request = listRequests.at(-1)!) {
  await act(async () => { request.resolve(projects); });
}
async function select(id: string) { await act(async () => resources.selectProject(id)); }

test('local projects stay local and a delayed directory does not replace a newly created project', async () => {
  seedLocal();
  await render();
  expect(listRequests).toHaveLength(0);
  expect(resources.principal).toBe('guest');
  await select('local-b');
  expect(resources.scopeKey).toBe('guest:local:local-b');
  await switchUser('user-a');
  let created!: Project;
  await act(async () => { created = (await resources.createProject('新本机项目', 'local'))!; });
  await publish([{ id: 'cloud-a', name: '私有项目 A' }]);
  expect(resources.projects.map((project) => project.id)).toEqual(['local-a', 'local-b', created.id, 'cloud-a']);
  expect(resources.selectedProject?.id).toBe(created.id);
  expect(resources.scopeKey).toBe(`user-a:local:${created.id}`);
  expect(localStorage.getItem('fob.local-projects')).not.toContain('私有项目 A');
});

test('an old identity directory response cannot appear in the next identity', async () => {
  seedLocal([]);
  await switchUser('user-a');
  const oldRequest = listRequests.at(-1)!;
  await switchUser('user-b');
  const currentRequest = listRequests.at(-1)!;
  expect(resources.projects).toEqual([]);
  expect(resources.scopeKey).toBeNull();
  await publish([{ id: 'a-private', name: 'A 私有项目' }], oldRequest);
  expect(resources.projects).toEqual([]);
  await publish([{ id: 'b-private', name: 'B 私有项目' }], currentRequest);
  expect(resources.projects).toEqual([{ id: 'b-private', name: 'B 私有项目', source: 'server' }]);
  expect(resources.scopeKey).toBe('user-b:server:b-private');
  await switchUser('user-a');
  expect(resources.projects).toEqual([]);
  await publish([{ id: 'a-private', name: 'A 私有项目' }]);
  expect(resources.projects.map((project) => project.id)).toEqual(['a-private']);
});

test('logout removes private projects immediately and ignores the old pending directory', async () => {
  seedLocal();
  await switchUser('user-a');
  const oldRequest = listRequests.at(-1)!;
  await switchUser(null);
  await select('local-b');
  await publish([{ id: 'private-cloud', name: '迟到的私有项目' }], oldRequest);
  expect(resources.projects.map((project) => project.id)).toEqual(['local-a', 'local-b']);
  expect(resources.scopeKey).toBe('guest:local:local-b');
  expect(resources.error).toBeNull();
});

test('guest and two account identities remember their selected projects independently', async () => {
  seedLocal();
  await render();
  await select('local-b');
  await switchUser('user-a');
  await publish([{ id: 'a-1', name: 'A1' }, { id: 'a-2', name: 'A2' }]);
  await select('a-2');
  await switchUser('user-b');
  await publish([{ id: 'b-1', name: 'B1' }, { id: 'b-2', name: 'B2' }]);
  await select('b-1');
  await switchUser(null);
  expect(resources.selectedProject?.id).toBe('local-b');
  await switchUser('user-a');
  await publish([{ id: 'a-1', name: 'A1' }, { id: 'a-2', name: 'A2' }]);
  expect(resources.selectedProject?.id).toBe('a-2');
  expect(resources.scopeKey).toBe('user-a:server:a-2');
  await switchUser('user-b');
  await publish([{ id: 'b-1', name: 'B1' }, { id: 'b-2', name: 'B2' }]);
  expect(resources.selectedProject?.id).toBe('b-1');
  expect(resources.scopeKey).toBe('user-b:server:b-1');
});

test('an unavailable saved selection falls back to the first real visible project', async () => {
  seedLocal();
  localStorage.setItem('fob.project.active.guest', JSON.stringify('deleted-project'));
  await render();
  expect(resources.selectedProject).toEqual({ ...localProjects[0], source: 'local' });
  await select('invisible-project');
  expect(resources.selectedProject?.id).toBe('local-a');
  seedLocal([]);
  localStorage.setItem('fob.project.active.user-a', JSON.stringify('unavailable-cloud'));
  await switchUser('user-a');
  expect(resources.selectedProject).toBeNull();
  await publish([{ id: 'first-real-cloud', name: '真实项目' }]);
  expect(resources.scopeKey).toBe('user-a:server:first-real-cloud');
});

test('local renaming trims and persists names while invalid mutations preserve the directory', async () => {
  seedLocal();
  await render();
  await act(async () => { expect(await resources.renameProject('local-a', '  新名称  ')).toBe(true); });
  expect(resources.selectedProject?.name).toBe('新名称');
  expect(JSON.parse(localStorage.getItem('fob.local-projects')!)[0]).toEqual({ id: 'local-a', name: '新名称' });
  const directory = resources.projects;
  await act(async () => {
    expect(await resources.renameProject('local-a', '  ')).toBe(false);
    expect(await resources.renameProject('missing', '新名称')).toBe(false);
    expect(await resources.removeProject('missing')).toBe(false);
  });
  expect(resources.projects).toEqual(directory);
  expect(resources.error).toBeNull();
});

test('failed server create, rename, delete and refresh retain the directory and selected scope', async () => {
  seedLocal([]);
  await switchUser('user-member');
  await publish([{ id: 'shared-project', name: '团队项目' }]);
  await select('shared-project');
  const directory = resources.projects;
  const localData = localStorage.getItem('fob.local-projects');
  const failure = new Error('Resource management permission is required.');
  createFailure = renameFailure = removeFailure = failure;
  await act(async () => { expect(await resources.createProject('被拒绝的新项目', 'server')).toBeNull(); });
  expect(resources.projects).toEqual(directory);
  await act(async () => { expect(await resources.renameProject('shared-project', '被拒绝的名称')).toBe(false); });
  expect(resources.projects).toEqual(directory);
  await act(async () => { expect(await resources.removeProject('shared-project')).toBe(false); });
  expect(resources.projects).toEqual(directory);
  let refreshing!: Promise<boolean>;
  await act(async () => { refreshing = resources.refreshProjects(); });
  await act(async () => { listRequests.at(-1)!.reject(new Error('Directory unavailable')); expect(await refreshing).toBe(false); });
  expect(resources.projects).toEqual(directory);
  expect(resources.scopeKey).toBe('user-member:server:shared-project');
  expect(resources.error).toBe('Directory unavailable');
  expect(localStorage.getItem('fob.local-projects')).toBe(localData);
  expect(JSON.parse(localStorage.getItem('fob.project.active.user-member')!)).toBe('shared-project');
  renameFailure = null;
  await act(async () => { expect(await resources.renameProject('shared-project', '已保存名称')).toBe(true); });
  expect(resources.selectedProject?.name).toBe('已保存名称');
  expect(resources.error).toBeNull();
});

test('a pending server creation preserves a directory received while it was saving', async () => {
  seedLocal([]);
  await switchUser('user-a');
  pendingCreate = deferred<Project>();
  let creating!: Promise<unknown>;
  await act(async () => { creating = resources.createProject('新项目', 'server'); });
  await publish([{ id: 'existing-cloud', name: '已有项目' }]);
  await act(async () => { pendingCreate!.resolve({ id: 'new-cloud', name: '新项目' }); await creating; });
  expect(resources.projects.map((project) => project.id)).toEqual(['existing-cloud', 'new-cloud']);
  expect(resources.scopeKey).toBe('user-a:server:new-cloud');
});

test('failed local directory storage rejects local create, rename and delete without changing the active project', async () => {
  seedLocal();
  await render();
  await select('local-b');
  const directory = resources.projects;
  const selected = resources.selectedProject;
  const savedDirectory = localStorage.getItem('fob.local-projects');
  const savedSelection = localStorage.getItem('fob.project.active.guest');
  const storage = localStorage;
  const originalSetItem = storage.setItem;
  Object.defineProperty(storage, 'setItem', { configurable: true, value: (key: string, value: string) => {
    if (key === 'fob.local-projects') throw new Error('Local project storage is full');
    originalSetItem.call(storage, key, value);
  } });
  try {
    await act(async () => { expect(await resources.createProject('无法保存的新项目', 'local')).toBeNull(); });
    expect(resources.projects).toEqual(directory);
    expect(resources.selectedProject).toEqual(selected);
    await act(async () => { expect(await resources.renameProject('local-b', '无法保存的名称')).toBe(false); });
    expect(resources.projects).toEqual(directory);
    expect(resources.selectedProject).toEqual(selected);
    await act(async () => { expect(await resources.removeProject('local-b')).toBe(false); });
    expect(resources.projects).toEqual(directory);
    expect(resources.selectedProject).toEqual(selected);
    expect(resources.scopeKey).toBe('guest:local:local-b');
    expect(resources.error).toBe('Local project storage is full');
    expect(localStorage.getItem('fob.local-projects')).toBe(savedDirectory);
    expect(localStorage.getItem('fob.project.active.guest')).toBe(savedSelection);
  } finally { Object.defineProperty(storage, 'setItem', { configurable: true, value: originalSetItem }); }
});

test('server mutations remain successful once each when local directory and selection storage are unavailable', async () => {
  seedLocal();
  await switchUser('user-a');
  await publish([{ id: 'existing-cloud', name: '已有项目' }]);
  await select('existing-cloud');
  const savedDirectory = localStorage.getItem('fob.local-projects');
  const savedSelection = localStorage.getItem('fob.project.active.user-a');
  const storage = localStorage;
  const originalSetItem = storage.setItem;
  let directoryWrites = 0;
  let preferenceWrites = 0;
  Object.defineProperty(storage, 'setItem', { configurable: true, value: (key: string, value: string) => {
    if (key === 'fob.local-projects') {
      directoryWrites++;
      throw new Error('Local project storage is full');
    }
    if (key.startsWith('fob.project.active.')) {
      preferenceWrites++;
      throw new Error('Selection storage is unavailable');
    }
    originalSetItem.call(storage, key, value);
  } });
  try {
    await act(async () => {
      expect(await resources.createProject('新服务端项目', 'server')).toEqual({ id: 'created-cloud', name: '新服务端项目', source: 'server' });
    });
    expect(resources.selectedProject?.id).toBe('created-cloud');
    await act(async () => { expect(await resources.renameProject('created-cloud', '已保存的服务端名称')).toBe(true); });
    expect(resources.selectedProject?.name).toBe('已保存的服务端名称');
    await act(async () => { expect(await resources.removeProject('created-cloud')).toBe(true); });
    expect(resources.projects).toEqual([
      ...localProjects.map(project => ({ ...project, source: 'local' })),
      { id: 'existing-cloud', name: '已有项目', source: 'server' },
    ]);
    expect(resources.scopeKey).toBe('user-a:local:local-a');
    expect(mutationCalls).toEqual({ create: 1, rename: 1, remove: 1 });
    expect(directoryWrites).toBe(0);
    expect(preferenceWrites).toBeGreaterThan(0);
    expect(localStorage.getItem('fob.local-projects')).toBe(savedDirectory);
    expect(localStorage.getItem('fob.project.active.user-a')).toBe(savedSelection);
  } finally { Object.defineProperty(storage, 'setItem', { configurable: true, value: originalSetItem }); }
});

for (const mutation of ['rename', 'remove', 'create'] as const) {
  test(`a late server ${mutation} cannot update a different signed-in identity`, async () => {
    seedLocal([]);
    await switchUser('user-a');
    await publish([{ id: 'old-cloud', name: '旧身份项目' }]);
    if (mutation === 'rename') pendingRename = deferred<Project>();
    if (mutation === 'remove') pendingRemove = deferred<void>();
    if (mutation === 'create') pendingCreate = deferred<Project>();
    let pending!: Promise<unknown>;
    await act(async () => {
      pending = mutation === 'rename' ? resources.renameProject('old-cloud', '迟到名称')
        : mutation === 'remove' ? resources.removeProject('old-cloud')
          : resources.createProject('迟到项目', 'server');
    });
    await switchUser('user-b');
    await publish([{ id: 'current-cloud', name: '当前身份项目' }]);
    await select('current-cloud');
    const currentDirectory = resources.projects;
    const currentSelection = localStorage.getItem('fob.project.active.user-b');
    await act(async () => {
      if (mutation === 'rename') pendingRename!.resolve({ id: 'old-cloud', name: '迟到名称' });
      else if (mutation === 'remove') pendingRemove!.resolve();
      else pendingCreate!.resolve({ id: 'late-cloud', name: '迟到项目' });
      expect(await pending).toBe(mutation === 'create' ? null : false);
    });
    expect(resources.projects).toEqual(currentDirectory);
    expect(resources.scopeKey).toBe('user-b:server:current-cloud');
    expect(resources.error).toBeNull();
    expect(localStorage.getItem('fob.project.active.user-b')).toBe(currentSelection);
    expect(localStorage.getItem('fob.local-projects')).not.toContain('迟到');
  });
}

test('StrictMode replay leaves the active directory usable and rejects its old directory response', async () => {
  seedLocal([]);
  session = { status: 'authenticated', user: { id: 'user-strict' } };
  await render(true);
  expect(listRequests.length).toBeGreaterThanOrEqual(2);
  await publish([{ id: 'strict-cloud', name: '原名称' }]);
  await act(async () => { expect(await resources.renameProject('strict-cloud', 'StrictMode 保存成功')).toBe(true); });
  await publish([{ id: 'stale-cloud', name: '旧目录' }], listRequests[0]!);
  expect(resources.projects).toEqual([{ id: 'strict-cloud', name: 'StrictMode 保存成功', source: 'server' }]);
  expect(resources.scopeKey).toBe('user-strict:server:strict-cloud');
  expect(resources.error).toBeNull();
});

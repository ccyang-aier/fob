import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { KnowledgeBase } from '@fob/shared/knowledge/contracts';
import type { useProjectKnowledgeDirectory } from './use-project-knowledge-directory';

let browser: Window;
let root: Root;
let renderCapture: () => React.ReactNode;
let directory: ReturnType<typeof useProjectKnowledgeDirectory>;
let selectedProject: { id: string; source: 'local' | 'server' } | null = { id: 'project-a', source: 'server' };
let principal = 'member-a';
const pending = new Map<string, (value: { items: KnowledgeBase[]; nextCursor: null }) => void>();
const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  globals.window = browser;
  globals.document = browser.document;
  globals.navigator = browser.navigator;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  browser.localStorage.setItem('fob.local-library', JSON.stringify({ bases: [
    { id: 'library-local-a', name: 'Local A', projectIds: ['local-a'] },
    { id: 'library-local-b', name: 'Local B', projectIds: ['local-b'] },
  ], folders: [], documents: [], tags: [] }));
  mock.module('@/features/identity/identity-provider', () => ({ useIdentity: () => ({ session: { status: 'authenticated', user: { id: principal } } }) }));
  mock.module('@/features/project/project-resources', () => ({ useProjectResources: () => ({ selectedProject }) }));
  mock.module('./knowledge-catalog-client', () => ({ knowledgeCatalogClient: {
    listKnowledgeBases: ({ projectId }: { projectId: string }) => new Promise((resolve) => {
      pending.set(`${principal}:${projectId}`, resolve);
    }),
  } }));
  const { useProjectKnowledgeDirectory: readDirectory } = await import('./use-project-knowledge-directory');
  function Capture() {
    const value = readDirectory();
    useEffect(() => { directory = value; }, [value]);
    return null;
  }
  renderCapture = () => <QueryClientProvider client={queryClient}><Capture /></QueryClientProvider>;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterAll(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  await browser.happyDOM.abort();
});

async function render() {
  await act(async () => { root.render(renderCapture()); });
}

async function complete(key: string, id: string) {
  await act(async () => {
    pending.get(key)!({ items: [{ id, name: id }], nextCursor: null });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test('project and identity switches cannot expose a late or cached directory from another scope', async () => {
  await render();
  expect(directory.knowledgeBases).toEqual([]);
  selectedProject = { id: 'project-b', source: 'server' };
  await render();
  await complete('member-a:project-a', 'foreign-a');
  expect(directory.knowledgeBases).toEqual([]);
  await complete('member-a:project-b', 'current-b');
  expect(directory.knowledgeBases.map((base) => base.id)).toEqual(['current-b']);

  principal = 'member-b';
  await render();
  expect(directory.knowledgeBases).toEqual([]);
  await complete('member-b:project-b', 'member-b-only');
  expect(directory.knowledgeBases.map((base) => base.id)).toEqual(['member-b-only']);

  selectedProject = { id: 'local-a', source: 'local' };
  await render();
  expect(directory.knowledgeBases.map((base) => base.id)).toEqual(['library-local-a']);
  selectedProject = { id: 'local-b', source: 'local' };
  await render();
  expect(directory.knowledgeBases.map((base) => base.id)).toEqual(['library-local-b']);
  selectedProject = null;
  await render();
  expect(directory.knowledgeBases).toEqual([]);
  expect(directory.status).toBe('empty');
  expect([...pending.keys()]).toEqual(['member-a:project-a', 'member-a:project-b', 'member-b:project-b']);
});

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { AppAlertProvider } from '@/components/app-alert-provider';
import { Window } from 'happy-dom';
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { createLocalLibraryStore, emptyLocalLibrary, newLocalDocument } from './local-library';
import { subscribeOpenPageTarget, type OpenPageTarget } from '../editor/open-target';

let root: Root;
let browser: Window;
beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const name of [
    'document',
    'navigator',
    'HTMLElement',
    'Element',
    'Node',
    'Event',
    'CustomEvent',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'MutationObserver',
    'ResizeObserver',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'localStorage',
  ])
    globals[name] = (browser as unknown as Record<string, unknown>)[name];
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterAll(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
});

test('editing either local pane updates the other pane without echo writes or erasing content', async () => {
  const { LocalDocumentEditor } = await import('./local-document-editor');
  let writes = 0;
  const store = createLocalLibraryStore({
    getItem: () => null,
    setItem: () => {
      writes++;
    },
  });
  const page = {
    ...newLocalDocument('base', 'Local split'),
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'paragraph' },
          content: [{ type: 'text', text: 'Original' }],
        },
      ],
    },
  };
  store.update((current) => ({ ...current, documents: [page] }));
  function Pane() {
    const library = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      () => emptyLocalLibrary,
    );
    const document = library.documents[0];
    return (
      <LocalDocumentEditor
        knowledgeBaseId="local-split"
        store={store}
        document={document}
        folderName="Folder"
        onBack={() => {}}
        onOpenSidebar={() => {}}
        onCreateDocument={() => {}}
        onChange={(patch) => {
          store.update((current) => ({
            ...current,
            documents: current.documents.map((item) => ({ ...item, ...patch })),
          }));
          return true;
        }}
      />
    );
  }
  await act(async () => {
    root.render(
      <AppAlertProvider>
        <Pane />
        <Pane />
      </AppAlertProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const editors = Array.from(
    document.querySelectorAll('.ProseMirror[aria-label="页面正文"]'),
  ) as (HTMLElement & { editor: Editor })[];
  expect(editors.length).toBe(2);
  const before = writes;
  await act(async () => {
    const view = editors[0].editor.view;
    view.dispatch(view.state.tr.insertText('First ', 1));
  });
  expect(editors[0].textContent).toBe('First Original');
  expect(editors[1].textContent).toBe('First Original');
  expect(writes).toBe(before + 1);
  await act(async () => {
    const view = editors[1].editor.view;
    view.dispatch(view.state.tr.insertText('Second ', 1));
  });
  expect(editors[0].textContent).toBe('Second First Original');
  expect(editors[1].textContent).toBe('Second First Original');
  expect(writes).toBe(before + 2);
  expect(store.getSnapshot().documents[0].body.content?.[0].content?.[0].text).toBe(
    'Second First Original',
  );
});

test('local page links and block references retain and open a target in another knowledge base', async () => {
  const { LocalDocumentEditor } = await import('./local-document-editor');
  const store = createLocalLibraryStore({ getItem: () => null, setItem: () => {} });
  const own = newLocalDocument('local-a', '主文档');
  const target = {
    ...newLocalDocument('local-b', '另一个知识库的文档'),
    body: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'target-block' },
          content: [{ type: 'text', text: '来源正文' }],
        },
      ],
    },
  };
  store.update((current) => ({
    ...current,
    bases: [
      { id: 'local-a', name: 'A', projectIds: ['project-a'] },
      { id: 'local-b', name: 'B', projectIds: ['project-b'] },
    ],
    documents: [own, target],
  }));
  function Pane() {
    const library = useSyncExternalStore(
      store.subscribe,
      store.getSnapshot,
      () => emptyLocalLibrary,
    );
    const current = library.documents.find((page) => page.id === own.id)!;
    return (
      <LocalDocumentEditor
        knowledgeBaseId={own.baseId}
        store={store}
        document={current}
        folderName="Folder"
        onBack={() => {}}
        onOpenSidebar={() => {}}
        onCreateDocument={() => {}}
        onChange={(patch) => {
          store.update((state) => ({
            ...state,
            documents: state.documents.map((page) =>
              page.id === own.id ? { ...page, ...patch } : page,
            ),
          }));
          return true;
        }}
      />
    );
  }
  await act(async () => {
    root.render(
      <AppAlertProvider>
        <Pane />
      </AppAlertProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
  const editor = (
    document.querySelector('.ProseMirror[aria-label="页面正文"]') as HTMLElement & {
      editor: Editor;
    }
  ).editor;
  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'pageLink' });
  });
  const pageChoice = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ).find((button) => button.textContent?.includes(target.title));
  expect(pageChoice).toBeDefined();
  await act(async () => {
    pageChoice!.click();
  });
  const pageLink = editor.getJSON().content?.find((node) => node.type === 'pageLink');
  expect(pageLink?.attrs).toMatchObject({ knowledgeBaseId: target.baseId, pageId: target.id });

  await act(async () => {
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: 'blockReference' });
  });
  const sourceChoice = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ).find((button) => button.textContent?.includes(target.title));
  expect(sourceChoice).toBeDefined();
  await act(async () => {
    sourceChoice!.click();
    await Promise.resolve();
  });
  const blockChoice = Array.from(
    document.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ).find((button) => button.textContent?.includes('来源正文'));
  expect(blockChoice).toBeDefined();
  await act(async () => {
    blockChoice!.click();
  });
  const reference = editor.getJSON().content?.find((node) => node.type === 'blockReference');
  expect(reference?.attrs).toMatchObject({
    knowledgeBaseId: target.baseId,
    pageId: target.id,
    targetBlockId: 'target-block',
  });
  expect(document.querySelector('[data-block-reference="live"]')?.textContent).toContain(
    '来源正文',
  );
  const opened: OpenPageTarget[] = [];
  const unsubscribe = subscribeOpenPageTarget((value) => opened.push(value));
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="打开来源块"]')!.click();
  });
  unsubscribe();
  expect(opened).toEqual([
    { knowledgeBaseId: target.baseId, pageId: target.id, blockId: 'target-block' },
  ]);
});

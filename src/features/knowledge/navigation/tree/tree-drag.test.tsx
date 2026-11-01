import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { act, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';
import { createDomEnvironment } from '@/test/dom-environment';
import type { TreeMove } from './tree-drop-policy';

let environment: ReturnType<typeof createDomEnvironment>, root: Root;
let renderTree: (options?: { write?: boolean; move?: (move: TreeMove) => Promise<void> }) => ReactNode;
let moves: TreeMove[], alerts: string[], expanded: string[];
beforeAll(async () => {
  environment = createDomEnvironment();
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: (_tone: string, text: string) => alerts.push(text) }) }));
  const { TreeDragProvider, TreeDragRow, TreeRootDropTarget } = await import('./tree-drag');
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const folders = [{ id: 'a' }, { id: 'b', parentId: 'a' }, { id: 'c', parentId: 'b' }, { id: 'other' }];
  const documents = [{ id: 'doc', folderId: 'a' }];
  renderTree = ({ write = true, move = async (placement: TreeMove) => { moves.push(placement); } } = {}) => <TreeDragProvider folders={folders} documents={documents} canMoveFolders={write} canMoveDocuments={write} onMove={move} onExpandFolder={id => expanded.push(id)} errorText={() => 'Persistence rejected'}>
    <TreeRootDropTarget>Folders</TreeRootDropTarget>
    {folders.map(folder => <TreeDragRow key={folder.id} item={{ kind: 'folder', id: folder.id }}>{folder.id}<button data-tree-drag-control>Menu</button></TreeDragRow>)}
    <TreeDragRow item={{ kind: 'document', id: 'doc' }}>Document</TreeDragRow>
  </TreeDragProvider>;
}, 30_000);
beforeEach(async () => { await act(async () => root.render(null)); moves = []; alerts = []; expanded = []; });
afterAll(async () => { await act(async () => root.unmount()); await environment.cleanup(); mock.restore(); });
const row = (id: string) => document.querySelector<HTMLElement>(`[data-tree-id="${id}"]`)!;
function transfer() {
  const data = new Map<string, string>();
  return { get types() { return [...data.keys()]; }, effectAllowed: 'none', dropEffect: 'none', setData: (type: string, value: string) => data.set(type, value) };
}
async function fire(element: Element, type: string, data: ReturnType<typeof transfer>) {
  await act(async () => { const event = new Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(event, 'dataTransfer', { value: data }); element.dispatchEvent(event); });
}

test('native drag events move a folder into a folder and back to the top-level heading', async () => {
  await act(async () => root.render(renderTree()));
  const data = transfer(); await fire(row('b'), 'dragstart', data); await fire(row('other'), 'dragenter', data);
  expect(data.dropEffect).toBe('move'); expect(row('other').dataset.treeDrop).toBe('true');
  await fire(row('other'), 'drop', data);
  expect(moves).toEqual([{ kind: 'folder', id: 'b', parentId: 'other' }]);
  expect(expanded).toContain('other');
  await fire(row('b'), 'dragstart', data); await fire(document.querySelector('[data-tree-root]')!, 'drop', data);
  expect(moves.at(-1)).toEqual({ kind: 'folder', id: 'b', parentId: null });
});

test('invalid descendants, missing drag state and document root drops cannot write', async () => {
  await act(async () => root.render(renderTree()));
  const data = transfer(); await fire(row('other'), 'drop', data); expect(moves).toHaveLength(0);
  await fire(row('b'), 'dragstart', data); await fire(row('c'), 'dragover', data);
  expect(data.dropEffect).toBe('none'); expect(document.querySelector('[role=status]')?.textContent).toContain('自身');
  await fire(row('c'), 'drop', data); expect(moves).toHaveLength(0);
  await fire(row('doc'), 'dragstart', data); await fire(document.querySelector('[data-tree-root]')!, 'drop', data); expect(moves).toHaveLength(0);
  await fire(row('doc'), 'dragstart', data); await fire(row('c'), 'drop', data); expect(moves).toEqual([{ kind: 'document', id: 'doc', folderId: 'c' }]);
});

test('read-only rows and row controls cannot begin a move; delayed failures retain the original tree', async () => {
  await act(async () => root.render(renderTree({ write: false })));
  const data = transfer(); await fire(row('b'), 'dragstart', data); expect(data.types).toHaveLength(0);
  let reject!: (error: Error) => void;
  await act(async () => root.render(renderTree({ move: placement => { moves.push(placement); return new Promise((_resolve, fail) => { reject = fail; }); } })));
  await act(async () => row('b').querySelector('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await fire(row('b'), 'dragstart', data); expect(data.types).toHaveLength(0);
  await act(async () => row('b').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
  await fire(row('b'), 'dragstart', data); await fire(row('other'), 'drop', data); await fire(row('other'), 'drop', data);
  expect(moves).toHaveLength(1); expect(row('b').getAttribute('draggable')).toBe('false');
  await act(async () => reject(new Error('backend refused')));
  expect(alerts).toContain('Persistence rejected'); expect(row('b').getAttribute('draggable')).toBe('true');
});

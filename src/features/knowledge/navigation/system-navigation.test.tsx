import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeWorkbench } from '../knowledge-workbench';
import { PageTreeSidebar } from './page-tree-sidebar';
import { KnowledgeNavigationOutlet, KnowledgeNavigationProvider, KnowledgeNavigationScope } from './system-navigation';

let browser: Window;
let root: Root;
let host: HTMLDivElement;
let activated = 0;
beforeAll(() => {
  browser = new Window({ url: 'http://localhost:3001' });
  Object.assign(globalThis, { window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, Element: browser.Element, Node: browser.Node, Event: browser.Event, MouseEvent: browser.MouseEvent, MutationObserver: browser.MutationObserver, localStorage: browser.localStorage, getComputedStyle: browser.getComputedStyle.bind(browser), ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); });

function Resource({ name, selected, visible }: { name: string; selected: boolean; visible: boolean }) {
  return <KnowledgeNavigationScope selected={selected} visible={visible} activate={() => activated++}>
    <section data-resource={name} hidden={!visible}><KnowledgeWorkbench navigationScope={name} sidebar={<PageTreeSidebar treeArea={<button type="button">{name} 主页</button>} />}><input aria-label={`${name} 正文`} defaultValue={name} /></KnowledgeWorkbench></section>
  </KnowledgeNavigationScope>;
}
function Surface({ owner, members = false }: { owner: 'A' | 'B'; members?: boolean }) {
  return <KnowledgeNavigationProvider onExpand={() => {}}><aside aria-label="系统导航"><KnowledgeNavigationOutlet /></aside><main><Resource name="A" selected={owner === 'A'} visible={!members && owner === 'A'} /><Resource name="B" selected={owner === 'B'} visible={!members && owner === 'B'} /></main></KnowledgeNavigationProvider>;
}

test('knowledge navigation is rendered once in the system sidebar and never inside content', async () => {
  await act(async () => root.render(<Surface owner="A" />));
  expect(host.querySelectorAll('aside').length).toBe(1);
  expect(host.querySelector('main [aria-label="知识库侧边栏"]')).toBeNull();
  expect(host.querySelector('aside')?.textContent).toContain('A 主页');
  expect(host.querySelector('aside')?.textContent).not.toContain('B 主页');
});

test('switching the sidebar owner preserves mounted document hosts and drafts', async () => {
  const draft = host.querySelector<HTMLInputElement>('[aria-label="A 正文"]')!;
  draft.value = '保留的研究草稿';
  await act(async () => root.render(<Surface owner="B" />));
  expect(host.querySelector('[aria-label="A 正文"]')).toBe(draft);
  expect(draft.value).toBe('保留的研究草稿');
  expect(host.querySelector('aside')?.textContent).toContain('B 主页');
  expect(host.querySelector('aside')?.textContent).not.toContain('A 主页');
});

test('navigation remains available on members pages and activates only its owning knowledge tab', async () => {
  await act(async () => root.render(<Surface owner="B" members />));
  const button = [...host.querySelectorAll('aside button')].find(button => button.textContent === 'B 主页')!;
  await act(async () => button.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(activated).toBe(1);
});

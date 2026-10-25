import { afterAll, beforeAll, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeWorkbench } from '../knowledge-workbench';
import { PageTreeSidebar } from './page-tree-sidebar';
import { KnowledgeNavigationOutlet, KnowledgeNavigationProvider, KnowledgeNavigationScope } from './system-navigation';
import { useKnowledgeNavigationCompact } from './system-navigation';
import { KnowledgeMainNavigation } from '../dense-sidebar/knowledge-main-navigation';
import { TooltipProvider } from '@/components/ui/tooltip';

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
    <section data-resource={name} hidden={!visible}><KnowledgeWorkbench sidebar={<PageTreeSidebar treeArea={<button type="button">{name} 主页</button>} />}><input aria-label={`${name} 正文`} defaultValue={name} /></KnowledgeWorkbench></section>
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

const mainActions: string[] = [];
function MainNavigation({ name }: { name: string }) {
  const compact = useKnowledgeNavigationCompact();
  return <KnowledgeMainNavigation compact={compact} activeItem="all-documents" counts={{ 'all-documents': 3 }} onNavigate={id => mainActions.push(`${name}:${id}`)} />;
}
function CompactSurface({ compact, owner = 'A', members = false }: { compact: boolean; owner?: 'A' | 'B'; members?: boolean }) {
  return <TooltipProvider><KnowledgeNavigationProvider onExpand={() => {}}><aside><KnowledgeNavigationOutlet compact={compact} /></aside><main>{(['A', 'B'] as const).map(name => <KnowledgeNavigationScope key={name} selected={owner === name} visible={!members && owner === name} activate={() => activated++}><KnowledgeWorkbench sidebar={<PageTreeSidebar treeArea={<MainNavigation name={name} />} />}><input aria-label={`${name} 正文`} defaultValue={name} /></KnowledgeWorkbench></KnowledgeNavigationScope>)}</main></KnowledgeNavigationProvider></TooltipProvider>;
}

test('collapsed navigation retains four real knowledge actions with the copied functional icon tones', async () => {
  await act(async () => root.render(<CompactSurface compact={false} />));
  const editor = host.querySelector<HTMLInputElement>('[aria-label="A 正文"]')!;
  editor.value = '保持正文草稿';
  await act(async () => root.render(<CompactSurface compact />));
  expect(host.querySelectorAll('aside').length).toBe(1);
  const buttons = [...host.querySelectorAll<HTMLButtonElement>('aside button')];
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual(['主页', '星标', '草稿', '回收站']);
  expect([...host.querySelectorAll('aside svg[data-icon-tone]')].map(icon => icon.getAttribute('data-icon-tone'))).toEqual(['teal', 'amber', 'indigo', 'rose']);
  await act(async () => buttons[1].click());
  expect(mainActions).toEqual(['A:starred']);
  expect(host.querySelector('[aria-label="A 正文"]')).toBe(editor);
  expect(editor.value).toBe('保持正文草稿');
});

test('collapsed knowledge actions stay bound to the selected navigation owner while another page is visible', async () => {
  const previousActivations = activated;
  await act(async () => root.render(<CompactSurface compact owner="B" members />));
  const trash = host.querySelector<HTMLButtonElement>('aside [aria-label="回收站"]')!;
  await act(async () => trash.click());
  expect(mainActions.at(-1)).toBe('B:trash');
  expect(activated).toBe(previousActivations + 1);
  expect(host.querySelectorAll('aside button').length).toBe(4);
});

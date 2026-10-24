import { afterAll, beforeAll, beforeEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import type { Root } from 'react-dom/client';

let browser: Window, host: HTMLDivElement, root: Root;
let Page: typeof import('./members-page').ProjectMembersPage;
let scope = 'project-a';
let setLocale: typeof import('@/lib/i18n').setLocale;

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/?view=members' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement', 'Element', 'Node', 'Event', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'CustomEvent', 'DocumentFragment', 'MutationObserver', 'ResizeObserver', 'getComputedStyle']) globals[key] = (browser as unknown as Record<string, unknown>)[key];
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  Object.defineProperties(browser.HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } },
  });
  mock.module('@phosphor-icons/react', () => Object.fromEntries(['TreeStructure', 'Tag', 'PushPin', 'PushPinSlash', 'Buildings', 'EnvelopeSimple', 'ClipboardText', 'FolderPlus', 'MagnifyingGlass', 'Plus', 'SlidersHorizontal', 'Stack', 'UserCircleGear', 'UserPlus', 'UsersThree', 'X', 'ArrowRight', 'CaretDown', 'CaretRight', 'Check', 'CheckCircle', 'Info', 'WarningCircle', 'XCircle', 'SquaresFour', 'Table'].map(name => [name, () => <svg aria-hidden />])));
  mock.module('@/components/user-avatar', () => ({ UserAvatar: ({ name }: { name: string }) => <span>{name[0]}</span> }));
  mock.module('@/components/ui/date-picker', () => ({ DatePicker: ({ value }: { value: string }) => <button type="button">{value}</button> }));
  mock.module('@/components/app-alert-provider', () => ({ useAppAlert: () => ({ notify: () => {} }) }));
  mock.module('../project-resources', () => ({ useProjectResources: () => ({ scopeKey: scope }) }));
  setLocale = (await import('@/lib/i18n')).setLocale;
  Page = (await import('./members-page')).ProjectMembersPage;
  const { createRoot } = await import('react-dom/client');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
beforeEach(async () => { await act(async () => root.render(null)); scope = 'project-a'; setLocale('zh-CN'); });
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort(); mock.restore(); });
async function render() { await act(async () => root.render(<Page />)); }
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === text)!;
const card = (name: string) => host.querySelector<HTMLButtonElement>(`[aria-label="查看 ${name}"]`)!;
const control = (name: string) => [...host.querySelectorAll('dialog label')].find(node => node.firstChild?.textContent === name)!.querySelector<HTMLInputElement>('input')!;
async function input(element: HTMLInputElement, value: string) { await act(async () => { Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(element, value); element.dispatchEvent(new Event('input', { bubbles: true })); }); }
async function submit() { await act(async () => host.querySelector('dialog form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }

test('the eight reference profiles remain searchable and switch to a complete list', async () => {
  await render(); expect(host.querySelectorAll('ul li')).toHaveLength(8);
  expect(host.textContent).toContain('Chief Operating Officer'); expect(host.textContent).toContain('小组二组');
  expect(host.textContent).not.toContain('在职');
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'binhan628');
  expect(host.querySelectorAll('ul li')).toHaveLength(1);
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'missing-person'); expect(host.textContent).toContain('没有匹配的成员');
  await act(async () => button('清除筛选').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="成员列表"]')!.click());
  expect(host.querySelectorAll('tbody tr')).toHaveLength(8);
});

test('project scope changes discard reference edits and active search from the previous scope', async () => {
  await render(); await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'Esther');
  scope = 'project-b'; await render();
  expect(host.querySelector<HTMLInputElement>('input[type=search]')!.value).toBe('');
  expect(host.querySelectorAll('ul li')).toHaveLength(8);
});

test('editing, cancellation, Escape and removal confirmation form a complete preview flow', async () => {
  await render(); await act(async () => card('Esther Howard').click());
  await input(control('姓名'), 'Uncommitted name'); await act(async () => button('取消').click());
  expect(card('Esther Howard')).not.toBeNull(); expect(card('Uncommitted name')).toBeNull();
  await act(async () => card('Esther Howard').click()); await input(control('姓名'), 'Esther Howard Jr'); await submit();
  expect(card('Esther Howard Jr')).not.toBeNull();
  await act(async () => card('Esther Howard Jr').click()); await act(async () => button('移除成员').click());
  expect(host.querySelector('[role=alertdialog]')).not.toBeNull();
  await act(async () => button('取消').click()); expect(host.querySelectorAll('ul li')).toHaveLength(8);
  await act(async () => button('保存更改').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(host.querySelector('dialog')).toBeNull();
  await act(async () => card('Esther Howard Jr').click()); await act(async () => button('移除成员').click()); await act(async () => button('移除成员').click());
  expect(host.querySelectorAll('ul li')).toHaveLength(7);
});

test('team structure is a placeholder with no department board or member tools', async () => {
  await render();
  await act(async () => button('团队结构').click());
  expect(host.querySelector('[role=tabpanel]')!.textContent).toBe('暂未开发');
  expect(host.querySelector('input[type=search]')).toBeNull();
  expect(host.querySelector('ul')).toBeNull();
  expect(button('新增成员')).toBeUndefined();
  expect(host.textContent).not.toContain('新建部门');
  await act(async () => button('团队结构').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })));
  expect(host.querySelectorAll('ul li')).toHaveLength(8);
});

test('a new member accepts arbitrary labels without creating a department', async () => {
  await render(); await act(async () => button('新增成员').click());
  await input(control('姓名'), 'New Designer'); await input(control('邮箱'), 'designer@example.test');
  await input(control('部门'), 'Design');
  await input(host.querySelector<HTMLInputElement>('[placeholder="搜索或输入新标签"]')!, '研发共创');
  await act(async () => button('添加标签').click());
  await submit();
  expect(host.querySelectorAll('ul li')).toHaveLength(9);
  expect(card('New Designer').textContent).toContain('研发共创');
});

test('custom labels are trimmed, deduplicated, pinned and committed only on save', async () => {
  await render(); await act(async () => card('Esther Howard').click());
  const labelInput = () => host.querySelector<HTMLInputElement>('[placeholder="搜索或输入新标签"]')!;
  await input(labelInput(), '  研发共创  ');
  await act(async () => labelInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
  expect(host.querySelector('dialog')).not.toBeNull();
  await input(labelInput(), '研发共创'); expect(button('添加标签').disabled).toBe(true);
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="置顶标签“研发共创”"]')!.click());
  expect(host.querySelector('[aria-label="取消置顶标签“研发共创”"]')!.getAttribute('aria-pressed')).toBe('true');
  await act(async () => button('取消').click());
  expect(card('Esther Howard').textContent).not.toContain('研发共创');
  await act(async () => card('Esther Howard').click());
  await input(labelInput(), '研发共创'); await act(async () => button('添加标签').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="取消置顶标签“小组二组”"]')!.click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="置顶标签“研发共创”"]')!.click());
  await submit();
  const labels = card('Esther Howard').querySelector('[aria-label="标签"]')!;
  expect(labels.firstElementChild!.textContent).toBe('研发共创');
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, '研发共创');
  expect(host.querySelectorAll('ul li')).toHaveLength(1);
});

test('existing labels can be reused and removed independently from member details', async () => {
  await render(); await act(async () => card('Marvin McKinney').click());
  await input(host.querySelector<HTMLInputElement>('[placeholder="搜索或输入新标签"]')!, '请假');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="添加标签“请假”"]')!.click());
  await submit(); expect(card('Marvin McKinney').textContent).toContain('请假');
  await act(async () => card('Marvin McKinney').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除标签“请假”"]')!.click());
  await submit(); expect(card('Marvin McKinney').textContent).toContain('未添加标签');
});

test('interface language follows app locale without discarding the open member draft', async () => {
  await render();
  expect(host.querySelector('h1')!.textContent).toBe('团队');
  expect(host.textContent).toContain('小组二组');
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="成员列表"]')!.click());
  expect(host.querySelector('time')!.textContent).toBe('2018年2月28日');
  await act(async () => card('Esther Howard').click());
  await input(control('姓名'), '草稿姓名');
  await act(async () => setLocale('en-US'));
  expect(host.querySelector('h1')!.textContent).toBe('Team');
  expect(host.querySelector('time')!.textContent).toBe('February 28, 2018');
  expect(host.querySelector('dialog')!.textContent).toContain('Member details');
  expect(control('Name').value).toBe('草稿姓名');
  await act(async () => setLocale('zh-CN'));
  expect(control('姓名').value).toBe('草稿姓名');
  expect(button('保存更改')).toBeDefined();
});

test('label filtering composes with search and clears after the last matching label is removed', async () => {
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="标签"]')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  const option = [...document.querySelectorAll<HTMLElement>('[role=menuitemradio]')].find(node => node.textContent === '请假')!;
  expect(option).toBeDefined();
  await act(async () => option.click());
  expect(host.querySelectorAll('ul li')).toHaveLength(1);
  expect(card('Annette Black')).not.toBeNull();
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, 'missing');
  expect(host.textContent).toContain('没有匹配的成员');
  await input(host.querySelector<HTMLInputElement>('input[type=search]')!, '');
  await act(async () => card('Annette Black').click());
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="移除标签“请假”"]')!.click());
  await submit();
  expect(host.querySelectorAll('ul li')).toHaveLength(8);
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="标签"]')!.textContent).toBe('标签');
});

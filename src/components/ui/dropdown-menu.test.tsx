import { afterAll, beforeAll, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, useState, type ReactNode } from 'react';
import type { Root } from 'react-dom/client';

let browser: Window;
let root: Root;
let overlay: HTMLElement;
let renderMenu: () => ReactNode;
let renderSearchMenu: () => ReactNode;
let renderSearchSubMenu: () => ReactNode;
let renderChoiceMenu: () => ReactNode;

beforeAll(async () => {
  browser = new Window({ url: 'http://localhost:3000/' });
  const globals = globalThis as Record<string, unknown>;
  for (const key of ['document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'Element', 'Node', 'NodeFilter', 'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'MutationObserver', 'getComputedStyle']) {
    globals[key] = (browser as unknown as Record<string, unknown>)[key];
  }
  globals.window = browser;
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  globals.requestAnimationFrame = browser.requestAnimationFrame.bind(browser);
  globals.cancelAnimationFrame = browser.cancelAnimationFrame.bind(browser);
  mock.module('@/lib/overlay-root', () => ({ getOverlayRoot: () => overlay }));
  mock.module('@/components/icons', () => Object.fromEntries(['Check', 'CaretRight', 'MagnifyingGlass', 'X'].map(name => [name, () => <svg aria-hidden />])));
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSearch, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuCheckboxItem } = await import('./dropdown-menu');
  renderMenu = () => <DropdownMenu><DropdownMenuTrigger>Open menu</DropdownMenuTrigger><DropdownMenuContent><DropdownMenuItem>Move task</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
  function SearchMenu() {
    const [query, setQuery] = useState('');
    return <DropdownMenu><DropdownMenuTrigger>Find person</DropdownMenuTrigger><DropdownMenuContent>
      <DropdownMenuSearch value={query} onValueChange={setQuery} placeholder="Search people" clearLabel="Clear search" />
      {['Alice', 'Ben'].filter(name => name.toLowerCase().includes(query.toLowerCase())).map(name => <DropdownMenuItem key={name}>{name}</DropdownMenuItem>)}
    </DropdownMenuContent></DropdownMenu>;
  }
  renderSearchMenu = () => <SearchMenu />;
  renderSearchSubMenu = () => <DropdownMenu><DropdownMenuTrigger>Find status</DropdownMenuTrigger><DropdownMenuContent>
    <DropdownMenuSub><DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger><DropdownMenuSubContent>
      <DropdownMenuSearch value="" onValueChange={() => {}} placeholder="Search statuses" clearLabel="Clear search" /><DropdownMenuItem>In progress</DropdownMenuItem>
    </DropdownMenuSubContent></DropdownMenuSub>
  </DropdownMenuContent></DropdownMenu>;
  renderChoiceMenu = () => <DropdownMenu><DropdownMenuTrigger>Choose option</DropdownMenuTrigger><DropdownMenuContent>
    <DropdownMenuRadioGroup value="icon"><DropdownMenuRadioItem value="icon" indicator="none"><svg data-option-icon />With icon</DropdownMenuRadioItem><DropdownMenuRadioItem value="plain">Plain option</DropdownMenuRadioItem></DropdownMenuRadioGroup>
    <DropdownMenuCheckboxItem checked indicator="none"><svg data-option-icon />Member portrait</DropdownMenuCheckboxItem>
  </DropdownMenuContent></DropdownMenu>;
  const { createRoot } = await import('react-dom/client');
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterAll(async () => {
  await act(async () => root.unmount());
  await browser.happyDOM.abort();
  mock.restore();
});

test('opening a menu after its previously rendered native dialog was removed uses the live overlay', async () => {
  const previousDialog = document.createElement('dialog');
  const workbench = document.createElement('main');
  document.body.append(previousDialog, workbench);
  overlay = previousDialog;
  await act(async () => root.render(renderMenu()));
  previousDialog.remove();
  overlay = workbench;
  await act(async () => {
    document.querySelector<HTMLButtonElement>('button')!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' }));
  });
  for (let turn = 0; turn < 30 && !workbench.querySelector('[role="menuitem"]'); turn++) await act(async () => { await Bun.sleep(0); });
  const menu = document.querySelector('[role="menu"]');
  expect(menu?.isConnected).toBe(true);
  expect(workbench.contains(menu)).toBe(true);
  expect(menu?.textContent).toBe('Move task');
  expect(previousDialog.querySelector('[role="menu"]')).toBeNull();
});

test('search keeps text editing inside the menu, supports arrow navigation and clears before Escape closes', async () => {
  await act(async () => root.render(renderSearchMenu()));
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Find person')!;
  await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  for (let turn = 0; turn < 30 && !document.querySelector('input'); turn++) await act(async () => { await Bun.sleep(0); });
  const input = document.querySelector<HTMLInputElement>('input')!;
  expect(document.activeElement).toBe(input);
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(browser.HTMLInputElement.prototype, 'value')!.set!.call(input, 'be');
    input.dispatchEvent(new browser.Event('input', { bubbles: true }) as unknown as Event);
  });
  expect([...document.querySelectorAll('[role="menuitem"]')].map(item => item.textContent)).toEqual(['Ben']);
  expect(document.activeElement).toBe(input);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })));
  expect(document.activeElement?.textContent).toBe('Ben');
  await act(async () => { input.focus(); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
  expect(input.value).toBe('');
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(document.querySelectorAll('[role="menuitem"]').length).toBe(2);
  await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  expect(document.querySelector('[role="menu"]')).toBeNull();
});

test('keyboard entry into a searchable submenu focuses its search after the Radix focus handoff', async () => {
  await act(async () => root.render(renderSearchSubMenu()));
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Find status')!;
  await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  const sub = document.querySelector<HTMLElement>('[role="menuitem"][aria-haspopup="menu"]')!;
  await act(async () => { sub.focus(); sub.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); });
  for (let turn = 0; turn < 40 && document.activeElement?.getAttribute('aria-label') !== 'Search statuses'; turn++) await act(async () => { await Bun.sleep(0); });
  expect(document.querySelectorAll('[role="menu"]').length).toBe(2);
  expect(document.activeElement?.getAttribute('aria-label')).toBe('Search statuses');
});

test('icon choices keep checked semantics without a second indicator or its spacer', async () => {
  await act(async () => root.render(null));
  await act(async () => root.render(renderChoiceMenu()));
  const trigger = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Choose option')!;
  await act(async () => trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })));
  const icon = document.querySelector<HTMLElement>('[role="menuitemradio"][data-indicator="none"]')!;
  expect(icon.getAttribute('aria-checked')).toBe('true');
  expect(icon.children.length).toBe(1);
  expect(icon.querySelector('[data-option-icon]')).not.toBeNull();
  expect(document.querySelector('[role="menuitemradio"][data-indicator="check"] > span')).not.toBeNull();
  const checkbox = document.querySelector('[role="menuitemcheckbox"]')!;
  expect(checkbox.getAttribute('aria-checked')).toBe('true');
  expect(checkbox.querySelector('span')).toBeNull();
});

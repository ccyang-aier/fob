import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { createDomEnvironment } from '@/test/dom-environment';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let root: Root;
let environment: ReturnType<typeof createDomEnvironment>;
let Harness: () => React.JSX.Element;

beforeAll(async () => {
  environment = createDomEnvironment();
  const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent } = await import('@/components/ui/dropdown-menu');
  const { DocumentStarButton } = await import('./index');
  const { DocumentStarMenuItem } = await import('./menu-item');
  Harness = function Harness() {
    const [starred, setStarred] = useState(false);
    const toggle = () => setStarred((value) => !value);
    return <>
      <DocumentStarButton starred={starred} onToggle={toggle} />
      <DropdownMenu><DropdownMenuTrigger>更多</DropdownMenuTrigger><DropdownMenuContent>
        <DocumentStarMenuItem starred={starred} onToggleStar={toggle} />
      </DropdownMenuContent></DropdownMenu>
    </>;
  };
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

beforeEach(async () => {
  await act(async () => root.render(null));
  await act(async () => root.render(<Harness />));
});
afterAll(async () => { await act(async () => root.unmount()); await environment.cleanup(); });

async function key(element: Element, value: string) {
  await act(async () => {
    (element as HTMLElement).focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
    // Radix restores focus in its unmount task after removing the focus scope.
    await Bun.sleep(0);
  });
}

describe('shared document star feedback', () => {
  test('menu stays open for mouse and keyboard toggles, celebrates only adding and cleans up on animation end', async () => {
    const trigger = Array.from(document.querySelectorAll('button')).find((button) => button.textContent === '更多')!;
    await key(trigger, 'Enter');
    const menuItem = document.querySelector('[role="menuitem"]')!;
    await act(async () => menuItem.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(menuItem.textContent).toBe('取消收藏');
    expect(document.querySelector('[aria-label="取消星标"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(menuItem.querySelector('[data-celebrating]')).not.toBeNull();
    expect(menuItem.querySelectorAll('[data-celebrating] > span > span').length).toBe(8);
    expect(document.querySelectorAll('[data-celebrating]').length).toBe(1);
    await act(async () => menuItem.querySelector('[data-celebrating] > svg')!.dispatchEvent(new Event('animationend', { bubbles: true })));
    expect(menuItem.querySelector('[data-celebrating]')).toBeNull();
    await key(menuItem, 'Enter');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    expect(menuItem.textContent).toBe('收藏');
    expect(menuItem.querySelector('[data-celebrating]')).toBeNull();
    await key(menuItem, ' ');
    expect(menuItem.textContent).toBe('取消收藏');
    expect(menuItem.querySelector('[data-celebrating]')).not.toBeNull();
    await key(menuItem, 'Escape');
    expect(document.querySelector('[role="menu"]') === null).toBe(true);
    await act(async () => { await Bun.sleep(0); });
    expect(document.activeElement === trigger).toBe(true);
  });

  test('header preserves its toggle behavior and uses the same animation', async () => {
    const button = document.querySelector('[aria-label="添加星标"]') as HTMLButtonElement;
    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.querySelector('[data-celebrating]')).not.toBeNull();
    await act(async () => button.querySelector('[data-celebrating] > svg')!.dispatchEvent(new Event('animationend', { bubbles: true })));
    expect(button.querySelector('[data-celebrating]')).toBeNull();
    await act(async () => button.click());
    expect(button.getAttribute('aria-pressed')).toBe('false');
    expect(button.querySelector('[data-celebrating]')).toBeNull();
  });
});

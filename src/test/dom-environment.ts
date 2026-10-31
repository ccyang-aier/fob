import { Window } from 'happy-dom';

const constructors = [
  'document', 'navigator', 'HTMLElement', 'HTMLInputElement', 'HTMLButtonElement',
  'HTMLTextAreaElement', 'HTMLSelectElement', 'HTMLFormElement', 'HTMLDialogElement',
  'Element', 'Node', 'NodeFilter', 'Document', 'DocumentFragment', 'Text',
  'Event', 'CustomEvent', 'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'FocusEvent',
  'InputEvent', 'MutationObserver', 'ResizeObserver', 'localStorage', 'sessionStorage',
] as const;
const methods = ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'] as const;

/** Install one consistent DOM realm before importing React views; restore it after unmount. */
export function createDomEnvironment(url = 'http://localhost:3001/') {
  const browser = new Window({ url });
  browser.document.write('<!doctype html><html><head></head><body></body></html>');
  browser.document.close();
  const previous = new Map<string, PropertyDescriptor | undefined>();
  const install = (name: string, value: unknown) => {
    previous.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  };
  const realm = browser as unknown as Record<string, unknown>;
  install('window', browser);
  for (const name of constructors) install(name, realm[name]);
  for (const name of methods) install(name, (realm[name] as (...args: unknown[]) => unknown).bind(browser));
  install('IS_REACT_ACT_ENVIRONMENT', true);
  return {
    browser,
    async cleanup() {
      await browser.happyDOM.abort();
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      }
    },
  };
}

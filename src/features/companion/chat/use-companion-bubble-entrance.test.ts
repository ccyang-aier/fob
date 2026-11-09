import { afterEach, beforeEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { followCompanionBubbleLayout, revealCompanionBubbles } from './use-companion-bubble-entrance';

let browser: Window, log: HTMLElement, motion: MediaQueryList;
let cancel: (() => void) | undefined;
const originalEvent = globalThis.Event;
const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 304, width: 304, height, x: 0, y: top, toJSON() {} });

beforeEach(() => {
  browser = new Window(); globalThis.Event = browser.Event as unknown as typeof Event;
  const query = browser.matchMedia('(prefers-reduced-motion: reduce)');
  motion = query as unknown as MediaQueryList;
  Object.defineProperty(motion, 'matches', { configurable: true, value: false });
  browser.matchMedia = () => query;
  const host = browser.document.createElement('div'); browser.document.body.append(host);
  log = host as unknown as HTMLElement;
  log.getBoundingClientRect = () => rect(100, 304);
  Object.defineProperties(log, { clientHeight: { value: 304 }, scrollHeight: { value: 1200 } });
});
afterEach(async () => { cancel?.(); cancel = undefined; await browser.happyDOM.abort(); globalThis.Event = originalEvent; });

function bubble(top: number, height = 80) {
  const node = browser.document.createElement('div') as unknown as HTMLElement;
  node.dataset.companionBubble = 'answer'; node.getBoundingClientRect = () => rect(top, height);
  log.append(node); return node;
}
const end = (node: HTMLElement) => node.dispatchEvent(new Event('animationend', { bubbles: true }));

test('only visible bubbles enter in reading order from below, and each releases its own compositor layer', () => {
  const offscreen = bubble(-200), first = bubble(70), second = bubble(175), last = bubble(290);
  cancel = revealCompanionBubbles(log);
  expect(log.scrollTop).toBeGreaterThan(0); expect(log.hasAttribute('data-bubble-opening')).toBe(true);
  expect(offscreen.hasAttribute('data-entering')).toBe(false);
  const delays = [first, second, last].map(node => parseFloat(node.style.getPropertyValue('--bubble-delay')));
  expect(delays[0]).toBe(0); expect(delays[1]).toBeGreaterThan(delays[0]); expect(delays[2]).toBeGreaterThan(delays[1]);
  expect(parseFloat(first.style.getPropertyValue('--bubble-from-y'))).toBeGreaterThan(parseFloat(last.style.getPropertyValue('--bubble-from-y')));
  end(first); expect(first.hasAttribute('data-entering')).toBe(false); expect(second.hasAttribute('data-entering')).toBe(true);
  end(second); end(last);
  expect(log.hasAttribute('data-bubble-opening')).toBe(false);
  expect([first, second, last].every(node => !node.style.getPropertyValue('--bubble-from-y'))).toBe(true);
});

test('user scrolling interrupts immediately and restores ordinary scroll reporting', () => {
  const first = bubble(120), last = bubble(250); let reports = 0;
  log.addEventListener('scroll', () => { reports++; }); cancel = revealCompanionBubbles(log);
  log.dispatchEvent(new Event('wheel'));
  expect(log.hasAttribute('data-bubble-opening')).toBe(false); expect(reports).toBe(1);
  expect([first, last].every(node => !node.hasAttribute('data-entering'))).toBe(true);
  end(first); expect(reports).toBe(1);
});

test('reduced motion shows the latest messages immediately and a live preference change finishes an entrance', () => {
  const node = bubble(150);
  Object.defineProperty(motion, 'matches', { value: true }); cancel = revealCompanionBubbles(log);
  expect(log.scrollTop).toBeGreaterThan(0); expect(node.hasAttribute('data-entering')).toBe(false);
  Object.defineProperty(motion, 'matches', { value: false }); cancel = revealCompanionBubbles(log);
  expect(node.hasAttribute('data-entering')).toBe(true);
  Object.defineProperty(motion, 'matches', { value: true }); motion.dispatchEvent(new Event('change'));
  expect(node.hasAttribute('data-entering')).toBe(false); expect(log.hasAttribute('data-bubble-opening')).toBe(false);
});

test('closing mid-entrance cancels delayed bubbles without publishing a stale scroll event', () => {
  const first = bubble(120), last = bubble(250); let reports = 0;
  log.addEventListener('scroll', () => { reports++; }); cancel = revealCompanionBubbles(log); cancel();
  expect([first, last].every(node => !node.hasAttribute('data-entering') && node.style.length === 0)).toBe(true);
  end(last); log.dispatchEvent(new Event('wheel'));
  expect(reports).toBe(0); expect(log.hasAttribute('data-bubble-opening')).toBe(false);
});

test('streaming follows the real message layout instead of the extra overflow of entering layers', () => {
  const last = bubble(290); log.style.paddingBottom = '30px';
  Object.defineProperties(last, { offsetTop: { configurable: true, value: 420 }, offsetHeight: { configurable: true, value: 100 } });
  log.scrollTo = options => { log.scrollTop = (options as ScrollToOptions).top ?? 0; };
  cancel = revealCompanionBubbles(log); followCompanionBubbleLayout(log);
  expect(log.scrollTop).toBe(246); expect(log.scrollTop).toBeLessThan(log.scrollHeight - log.clientHeight);
  Object.defineProperty(last, 'offsetHeight', { value: 180 }); followCompanionBubbleLayout(log);
  expect(log.scrollTop).toBe(326);
});

test('a long history never measures old offscreen bubbles while opening the latest messages', () => {
  for (let index = 0; index < 100; index++) bubble(-500).getBoundingClientRect = () => { throw new Error('Old history was measured'); };
  const edge = bubble(-100); const first = bubble(120), last = bubble(250);
  cancel = revealCompanionBubbles(log);
  expect(first.hasAttribute('data-entering')).toBe(true); expect(last.hasAttribute('data-entering')).toBe(true);
  expect(edge.hasAttribute('data-entering')).toBe(false);
});

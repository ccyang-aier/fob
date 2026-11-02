import { afterAll,beforeAll,expect,test } from 'bun:test';
import { Window } from 'happy-dom';
import { act } from 'react';
import { createRoot,type Root } from 'react-dom/client';
import { useActiveLearning } from './use-active-learning';

let browser:Window,root:Root;
let clock=0,focused=true,timer:(() => void)|undefined;
const credits:number[]=[];
const originalPerformance=globalThis.performance;
function Reader({ scope='first',enabled=true }:{scope?:string;enabled?:boolean}) {
  useActiveLearning(scope,enabled,async seconds => { credits.push(seconds); }); return null;
}
async function tick(seconds:number) { for(let n=0;n<seconds;n++) { clock+=1000; await act(async () => { timer?.(); }); } }
beforeAll(() => {
  browser=new Window();
  Object.assign(globalThis,{ window:browser,document:browser.document,IS_REACT_ACT_ENVIRONMENT:true });
  Object.defineProperty(globalThis,'performance',{ configurable:true,value:new Proxy(originalPerformance,{ get(target,property) {
    if (property==='now') return () => clock;
    const value=Reflect.get(target,property,target);
    return typeof value==='function' ? value.bind(target) : value;
  } }) });
  Object.defineProperty(document,'visibilityState',{ configurable:true,value:'visible' });
  document.hasFocus=() => focused;
  window.setInterval=((callback:() => void) => { timer=callback; return 1; }) as typeof window.setInterval;
  window.clearInterval=() => { timer=undefined; };
  const host=document.createElement('div');document.body.append(host);root=createRoot(host);
});
afterAll(async () => { await act(async () => root.unmount());Object.defineProperty(globalThis,'performance',{ configurable:true,value:originalPerformance });await browser.happyDOM.abort(); });

test('only foreground, focused, recent document activity earns bounded time; dialogs, idle and hidden tabs pause it',async () => {
  await act(async () => root.render(<Reader />)); expect(credits).toEqual([0]);
  await tick(15);expect(credits).toEqual([0,15]);
  Object.defineProperty(document,'visibilityState',{ configurable:true,value:'hidden' });
  await tick(15);expect(credits).toEqual([0,15]);
  Object.defineProperty(document,'visibilityState',{ configurable:true,value:'visible' });focused=false;
  await tick(15);expect(credits).toEqual([0,15]);focused=true;
  const modal=document.createElement('dialog');modal.setAttribute('open','');document.body.append(modal);
  await tick(15);expect(credits).toEqual([0,15]);modal.remove();
  await tick(45);expect(credits.slice(0,4)).toEqual([0,15,15,14]);
  const idleCalls=credits.length;await tick(15);expect(credits.length).toBe(idleCalls);
  window.dispatchEvent(new browser.Event('pointerdown') as unknown as Event);
  await tick(15);expect(credits.at(-1)).toBe(15);
  await act(async () => root.render(<Reader enabled={false} />));expect(timer).toBeUndefined();
  await act(async () => root.render(<Reader scope="second" />));expect(credits.at(-1)).toBe(0);
  await act(async () => root.unmount());expect(timer).toBeUndefined();
});

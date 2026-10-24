import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SidebarResizeHandle as Handle, useSidebarWidth as Width } from './sidebar-resize'

let browser: Window, root: Root, SidebarResizeHandle: typeof Handle, useSidebarWidth: typeof Width
beforeAll(async () => {
  browser = new Window()
  const globals = globalThis as Record<string, unknown>
  for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'Event', 'PointerEvent']) globals[name] = (browser as unknown as Record<string, unknown>)[name]
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true
  ;({ SidebarResizeHandle, useSidebarWidth } = await import('./sidebar-resize'))
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort() })
function Harness() {
  const { width, dragging, startResize } = useSidebarWidth()
  return <><input /><output>{width}</output><SidebarResizeHandle dragging={dragging} onPointerDown={startResize} /></>
}
async function pointer(target: EventTarget, type: string, x: number, button = 0) {
  await act(async () => target.dispatchEvent(new PointerEvent(type, { pointerId: 1, button, clientX: x, bubbles: true, cancelable: true })))
}

test('sidebar drag feedback survives movement and clears on release, cancellation, capture loss and window blur', async () => {
  for (const ending of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) {
    await act(async () => root.render(<Harness key={ending} />))
    const handle = document.querySelector<HTMLButtonElement>('button')!
    handle.setPointerCapture = () => {}
    document.querySelector('input')!.focus()
    await pointer(handle, 'pointerdown', 224, 2)
    expect(handle.dataset.resizing).toBeUndefined()
    await pointer(handle, 'pointerdown', 224)
    expect(handle.dataset.resizing).toBe('true')
    expect(document.activeElement?.tagName).toBe('INPUT')
    await pointer(window, 'pointermove', 800)
    expect(document.querySelector('output')?.textContent).toBe('360')
    expect(handle.dataset.resizing).toBe('true')
    if (ending === 'blur') await act(async () => window.dispatchEvent(new Event('blur')))
    else await pointer(handle, ending, 800)
    expect(handle.dataset.resizing).toBeUndefined()
    await pointer(window, 'pointermove', 20)
    expect(document.querySelector('output')?.textContent).toBe('360')
  }
})

import { afterAll, beforeAll, expect, test } from 'bun:test'
import { Window } from 'happy-dom'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { SidebarResizeHandle as Handle, useSidebarWidth as Width } from './sidebar-resize'

let browser: Window, root: Root, SidebarResizeHandle: typeof Handle, useSidebarWidth: typeof Width
beforeAll(async () => {
  browser = new Window()
  const globals = globalThis as Record<string, unknown>
  for (const name of ['document', 'HTMLElement', 'Element', 'Node', 'Event', 'PointerEvent', 'KeyboardEvent']) globals[name] = (browser as unknown as Record<string, unknown>)[name]
  globals.window = browser; globals.IS_REACT_ACT_ENVIRONMENT = true
  ;({ SidebarResizeHandle, useSidebarWidth } = await import('./sidebar-resize'))
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort() })
function Harness() {
  const { width, dragging, startResize } = useSidebarWidth()
  return <><input /><output>{width}</output><SidebarResizeHandle dragging={dragging} onPointerDown={startResize} /></>
}
function RightHarness() {
  const { width, dragging, startResize, resizeBy } = useSidebarWidth(400, { side: 'right', minWidth: 280, maxWidth: 640 })
  return <><output>{width}</output><SidebarResizeHandle dragging={dragging} onPointerDown={startResize} onKeyDown={event => resizeBy(event.key === 'ArrowLeft' ? 24 : -24)} /></>
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

test('right rail grows towards the document, clamps both bounds and supports keyboard resizing', async () => {
  await act(async () => root.render(<RightHarness />))
  const handle = document.querySelector<HTMLButtonElement>('button')!
  handle.setPointerCapture = () => {}
  await pointer(handle, 'pointerdown', 800)
  await pointer(window, 'pointermove', 700)
  expect(document.querySelector('output')?.textContent).toBe('500')
  await pointer(window, 'pointermove', 0)
  expect(document.querySelector('output')?.textContent).toBe('640')
  await pointer(window, 'pointermove', 1200)
  expect(document.querySelector('output')?.textContent).toBe('280')
  await pointer(handle, 'pointerup', 1200)
  await act(async () => handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  expect(document.querySelector('output')?.textContent).toBe('304')
  expect(handle.dataset.resizing).toBeUndefined()
})

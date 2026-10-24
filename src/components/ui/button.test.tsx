import { afterAll, beforeAll, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act, createRef } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { Button as ButtonComponent } from "./button"

let browser: Window
let root: Root
let Button: typeof ButtonComponent

beforeAll(async () => {
  browser = new Window({ url: "http://localhost:3010" })
  const globals = globalThis as Record<string, unknown>
  for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"]) {
    globals[key] = (browser as unknown as Record<string, unknown>)[key]
  }
  globals.window = browser
  globals.IS_REACT_ACT_ENVIRONMENT = true
  Button = (await import("./button")).Button
  const host = document.createElement("div")
  document.body.append(host)
  root = createRoot(host)
})

afterAll(async () => {
  await act(async () => root.unmount())
  await browser.happyDOM.abort()
})

test("busy buttons retain their accessible label and original content footprint", async () => {
  await act(async () => root.render(
    <Button loading aria-label="登录账户">
      <svg aria-hidden="true" width="16" height="16" />
      <span>登录</span>
    </Button>,
  ))
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(button.getAttribute("aria-label")).toBe("登录账户")
  expect(button.getAttribute("aria-busy")).toBe("true")
  const content = button.querySelector('[data-slot="button-content"]')!
  expect(content.textContent).toBe("登录")
  expect(content.querySelector("svg")?.getAttribute("width")).toBe("16")
  expect(content.hasAttribute("aria-hidden")).toBe(false)
  const loading = button.querySelector('[data-slot="button-loading"]')!
  expect(loading.getAttribute("aria-hidden")).toBe("true")
  expect(loading.childElementCount).toBe(3)
})

test("loading blocks duplicate clicks and restores the original enabled action", async () => {
  let clicks = 0
  const action = () => { clicks++ }
  await act(async () => root.render(<Button loading onClick={action}>保存修改</Button>))
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(button.disabled).toBe(true)
  await act(async () => button.click())
  expect(clicks).toBe(0)
  await act(async () => root.render(<Button onClick={action}>保存修改</Button>))
  expect(button.disabled).toBe(false)
  expect(button.hasAttribute("aria-busy")).toBe(false)
  expect(button.textContent).toBe("保存修改")
  expect(button.querySelector('[data-slot="button-loading"]')).toBeNull()
  await act(async () => button.click())
  expect(clicks).toBe(1)
})

test("existing aria-busy callers receive dots and keep caller-disabled state afterwards", async () => {
  await act(async () => root.render(<Button aria-busy="true">退出登录</Button>))
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(button.disabled).toBe(true)
  expect(button.textContent).toBe("退出登录")
  expect(button.querySelector('[data-slot="button-loading"]')).not.toBeNull()
  await act(async () => root.render(<Button aria-busy={false} disabled>退出登录</Button>))
  expect(button.disabled).toBe(true)
  expect(button.getAttribute("aria-busy")).toBe("false")
  expect(button.querySelector('[data-slot="button-loading"]')).toBeNull()
})

test("ordinary buttons preserve children, variants and React 19 refs", async () => {
  const ref = createRef<HTMLButtonElement>()
  await act(async () => root.render(<Button ref={ref} variant="outline" size="sm" type="submit"><span>提交</span></Button>))
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(ref.current).toBe(button)
  expect(button.type).toBe("submit")
  expect(button.classList.contains("fob-action")).toBe(true)
  expect(button.classList.contains("h-8")).toBe(true)
  expect(button.firstElementChild?.textContent).toBe("提交")
  expect(button.querySelector('[data-slot="button-content"]')).toBeNull()
})

test("asChild preserves the slotted element, child event handler and ref", async () => {
  const ref = createRef<HTMLButtonElement>()
  let parentCalls = 0
  let childCalls = 0
  await act(async () => root.render(
    <Button asChild ref={ref} onClick={() => { parentCalls++ }}>
      <button type="button" onClick={() => { childCalls++ }}>菜单入口</button>
    </Button>,
  ))
  const button = document.querySelector<HTMLButtonElement>("button")!
  expect(document.querySelectorAll("button").length).toBe(1)
  expect(ref.current).toBe(button)
  expect(button.textContent).toBe("菜单入口")
  expect(button.querySelector('[data-slot="button-content"]')).toBeNull()
  await act(async () => button.click())
  expect(parentCalls).toBe(1)
  expect(childCalls).toBe(1)
  await act(async () => root.render(<Button asChild><button disabled>不可用入口</button></Button>))
  expect(document.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true)
})

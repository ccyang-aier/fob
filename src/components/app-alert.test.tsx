import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { act, useEffect } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { AppAlert as AlertComponent } from "./app-alert"
import type { AppAlertProvider as ProviderComponent, useAppAlert as AlertHook } from "./app-alert-provider"

let browser: Window
let root: Root
let AppAlert: typeof AlertComponent
let AppAlertProvider: typeof ProviderComponent
let useAppAlert: typeof AlertHook
let api: ReturnType<typeof AlertHook>
let nextTimer = 0
const timers = new Map<number, { run: () => void; delay: number }>()

beforeAll(async () => {
  browser = new Window({ url: "http://localhost:3000" })
  const globals = globalThis as Record<string, unknown>
  for (const key of ["document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent", "MutationObserver", "getComputedStyle"]) globals[key] = (browser as unknown as Record<string, unknown>)[key]
  globals.window = browser
  globals.IS_REACT_ACT_ENVIRONMENT = true
  // Drive the notification's own timers explicitly, without real-time sleeps.
  Object.defineProperty(browser, "setTimeout", { value: (run: () => void, delay = 0) => { const id = ++nextTimer; timers.set(id, { run, delay }); return id } })
  Object.defineProperty(browser, "clearTimeout", { value: (id: number) => timers.delete(id) })
  AppAlert = (await import("./app-alert")).AppAlert
  ;({ AppAlertProvider, useAppAlert } = await import("./app-alert-provider"))
  const container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

function Consumer({ page }: { page: string }) {
  const current = useAppAlert()
  useEffect(() => { api = current }, [current])
  return <div>{page}</div>
}

async function render(page = "第一页") {
  await act(async () => root.render(<AppAlertProvider><Consumer page={page} /></AppAlertProvider>))
}

async function runTimer(delay: number) {
  const entry = [...timers.entries()].find(([, timer]) => timer.delay === delay)
  expect(entry).toBeDefined()
  timers.delete(entry![0])
  await act(async () => entry![1].run())
}

beforeEach(async () => { await act(async () => root.render(null)); timers.clear(); await render() })
afterAll(async () => { await act(async () => root.unmount()); await browser.happyDOM.abort() })

test("one global host replaces messages and survives changing the page", async () => {
  await act(async () => { api.notify("success", "已保存"); api.notify("error", "保存失败", "内容已保留") })
  expect(document.querySelectorAll("[data-app-alert-host]").length).toBe(1)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("内容已保留")
  expect(document.querySelector('[role="alert"]')?.getAttribute("aria-live")).toBe("assertive")
  expect(document.body.textContent).not.toContain("已保存")
  await render("第二页")
  expect(document.body.textContent).toContain("第二页")
  expect(document.querySelector("[data-app-alert-host]")?.textContent).toContain("保存失败")
})

test("a superseded timeout or async dismissal cannot close a newer notification", async () => {
  let previous = 0
  await act(async () => { previous = api.notify("info", "正在导出", undefined, { duration: 100 }) })
  const stale = [...timers.values()].find(timer => timer.delay === 100)!.run
  await act(async () => { api.notify("success", "已导出", undefined, { duration: 200 }); stale(); api.dismiss(previous) })
  expect(document.querySelector("[data-app-alert-host]")?.textContent).toContain("已导出")
  expect(document.querySelector("[data-closing]")).toBeNull()
  await runTimer(200)
  expect(document.querySelector("[data-closing]")).not.toBeNull()
  await runTimer(160)
  expect(document.querySelector("[data-app-alert-host]")).toBeNull()
})

test("persistent progress can be closed manually and replacement restarts timing", async () => {
  await act(async () => { api.notify("info", "正在生成 PDF…", undefined, { duration: 0 }) })
  expect(timers.size).toBe(0)
  await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="关闭通知"]')!.click())
  expect(document.querySelector("[data-closing]")).not.toBeNull()
  await act(async () => { api.notify("success", "已生成 PDF") })
  expect(document.querySelector("[data-closing]")).toBeNull()
  expect([...timers.values()].map(timer => timer.delay)).toEqual([3200])
})

test("reading with a pointer or keyboard pauses automatic dismissal", async () => {
  await act(async () => { api.notify("warning", "检查权限", undefined, { duration: 500 }) })
  const host = document.querySelector("[data-app-alert-host]")!
  await act(async () => host.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })))
  expect(timers.size).toBe(0)
  await act(async () => host.dispatchEvent(new MouseEvent("mouseout", { bubbles: true })))
  expect([...timers.values()].map(timer => timer.delay)).toEqual([500])
  const close = host.querySelector<HTMLButtonElement>("button")!
  await act(async () => close.focus())
  expect(timers.size).toBe(0)
  await act(async () => close.blur())
  expect([...timers.values()].map(timer => timer.delay)).toEqual([500])
})

test("persistent inline messages share semantics and retain actionable recovery", async () => {
  let retried = false
  await act(async () => root.render(<AppAlert tone="error" title="连接失败" description="当前内容已保留" action={<button onClick={() => { retried = true }}>重试</button>} />))
  expect(document.querySelector("[data-app-alert-host]")).toBeNull()
  expect(document.querySelector('[role="alert"]')?.getAttribute("aria-atomic")).toBe("true")
  await act(async () => document.querySelector<HTMLButtonElement>("button")!.click())
  expect(retried).toBe(true)
})

test("notifications stay actionable inside a native dialog and return to the page on close", async () => {
  const dialog = document.createElement("dialog")
  dialog.setAttribute("open", "")
  document.body.append(dialog)
  await act(async () => { api.notify("success", "已复制日志") })
  expect(document.querySelector("[data-app-alert-host]")?.parentElement).toBe(dialog)
  await act(async () => { dialog.removeAttribute("open") })
  expect(document.querySelector("[data-app-alert-host]")?.parentElement).toBe(document.body)
  expect(document.querySelector("[data-app-alert-host]")?.textContent).toContain("已复制日志")
  dialog.remove()
})

test("the active native dialog owns notifications even when another dialog follows it in the DOM", async () => {
  const active = document.createElement("dialog"), other = document.createElement("dialog")
  for (const dialog of [active, other]) { dialog.setAttribute("open", ""); document.body.append(dialog) }
  const control = document.createElement("button")
  active.append(control)
  control.focus()
  await act(async () => { api.notify("success", "已复制") })
  expect(document.querySelector("[data-app-alert-host]")?.parentElement).toBe(active)
  await act(async () => { active.remove(); other.remove() })
})

"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"

import { AppAlert, type AppAlertProps, type AppAlertTone } from "./app-alert"
import styles from "./app-alert.module.css"

type AlertOptions = { duration?: number; markerColor?: string }
type Notification = AppAlertProps & { id: number; duration: number }
type AlertContext = {
  notify: (tone: AppAlertTone, title: string, description?: string, options?: AlertOptions) => number
  dismiss: (id?: number) => void
}

const AlertContext = createContext<AlertContext | null>(null)

function AlertHost({ notification, dismiss }: { notification: Notification; dismiss: (id: number) => void }) {
  const surface = useRef<HTMLDivElement>(null)
  const [container, setContainer] = useState<HTMLElement>(() => document.body)
  const [closing, setClosing] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    // Native modal dialogs make the rest of the document inert, regardless of z-index.
    const syncContainer = () => {
      const dialogs = document.querySelectorAll<HTMLDialogElement>("dialog[open]")
      const focusedDialog = document.activeElement?.closest<HTMLDialogElement>("dialog[open]")
      setContainer(focusedDialog ?? dialogs.item(dialogs.length - 1) ?? document.body)
    }
    syncContainer()
    const observer = new MutationObserver(syncContainer)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => { surface.current?.showPopover?.() }, [container])

  useEffect(() => {
    if (closing || hovered || focused || notification.duration <= 0) return
    const timer = window.setTimeout(() => setClosing(true), notification.duration)
    return () => window.clearTimeout(timer)
  }, [closing, hovered, focused, notification.duration])

  useEffect(() => {
    if (!closing) return
    const timer = window.setTimeout(() => dismiss(notification.id), 160)
    return () => window.clearTimeout(timer)
  }, [closing, dismiss, notification.id])

  return createPortal(
    <div
      ref={surface}
      popover="manual"
      data-app-alert-host=""
      data-closing={closing || undefined}
      className={styles.host}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}
    >
      <AppAlert {...notification} onClose={() => setClosing(true)} />
    </div>,
    container,
  )
}

/** One app-wide host survives page navigation; feature code only publishes messages. */
export function AppAlertProvider({ children }: { children: ReactNode }) {
  const [notification, setNotification] = useState<Notification | null>(null)
  const nextId = useRef(0)
  const notify = useCallback<AlertContext["notify"]>((tone, title, description, options) => {
    const id = ++nextId.current
    setNotification({ id, tone, title, description, duration: options?.duration ?? (tone === "error" ? 6000 : 3200), markerColor: options?.markerColor })
    return id
  }, [])
  const dismiss = useCallback((id?: number) => {
    setNotification(current => id === undefined || current?.id === id ? null : current)
  }, [])
  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss])

  return (
    <AlertContext.Provider value={value}>
      {children}
      {notification ? <AlertHost key={notification.id} notification={notification} dismiss={dismiss} /> : null}
    </AlertContext.Provider>
  )
}

export function useAppAlert() {
  const context = useContext(AlertContext)
  if (!context) throw new Error("AppAlertProvider must wrap the Fob application.")
  return context
}

"use client"

import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, CaretRight, MagnifyingGlass, X } from "@phosphor-icons/react"

import { getOverlayRoot, OverlayRootContext } from "@/lib/overlay-root"
import { cn } from "@/lib/utils"

const DropdownMenuContainer = React.createContext<HTMLElement | undefined>(undefined)

function DropdownMenu({ onOpenChange, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [container, setContainer] = React.useState<HTMLElement>()
  return <DropdownMenuContainer.Provider value={container}>
    <DropdownMenuPrimitive.Root {...props} onOpenChange={open => {
      // Resolve on opening: a native dialog may have closed since the last render.
      if (open) setContainer(getOverlayRoot())
      onOpenChange?.(open)
    }} />
  </DropdownMenuContainer.Provider>
}
function DropdownMenuTrigger({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
  return (
    <DropdownMenuPrimitive.Trigger
      className={cn(
        "fob-action dropdown-menu-trigger",
        className,
      )}
      {...props}
    />
  )
}
const DropdownMenuGroup = DropdownMenuPrimitive.Group

function keepSearchOpenOnEscape(event: KeyboardEvent) {
  // Radix handles Escape on document capture, before the input clears its query.
  if (event.target instanceof HTMLInputElement && event.target.closest('.dropdown-menu-search') && event.target.value) event.preventDefault()
}

function DropdownMenuSearch({ value, onValueChange, placeholder, clearLabel }: {
  value: string; onValueChange: (value: string) => void; placeholder: string; clearLabel: string
}) {
  const input = React.useRef<HTMLInputElement>(null)
  React.useEffect(() => {
    // Focus after Radix finishes handing keyboard entry into a submenu.
    const frame = requestAnimationFrame(() => input.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])
  return <div className="dropdown-menu-search">
    <MagnifyingGlass size={14} aria-hidden />
    <input ref={input} autoFocus value={value} placeholder={placeholder} aria-label={placeholder}
      onChange={event => onValueChange(event.target.value)} onKeyDown={event => {
        if (event.key === 'Escape') {
          if (value) { event.preventDefault(); event.stopPropagation(); onValueChange('') }
          return
        }
        event.stopPropagation()
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([data-disabled])')
          if (items?.length) { event.preventDefault(); items[event.key === 'ArrowDown' ? 0 : items.length - 1].focus() }
        }
      }} />
    {value && <button type="button" className="fob-action" aria-label={clearLabel} onClick={() => { onValueChange(''); input.current?.focus() }}><X size={12} /></button>}
  </div>
}

function DropdownMenuContent({
  className,
  sideOffset = 6,
  onCloseAutoFocus,
  onEscapeKeyDown,
  density = "regular",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content> & { density?: "regular" | "compact" }) {
  const inheritedContainer = React.useContext(OverlayRootContext)
  const capturedContainer = React.useContext(DropdownMenuContainer)
  const container = inheritedContainer ?? capturedContainer ?? getOverlayRoot()
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.Content
        data-density={density}
        sideOffset={sideOffset}
        className={cn(
          "menu-surface z-50 min-w-44 overflow-hidden rounded-[7px] border bg-elevated p-1 text-[12px] text-[var(--ink)]",
          className,
        )}
        {...props}
        onEscapeKeyDown={event => { onEscapeKeyDown?.(event); keepSearchOpenOnEscape(event) }}
        onCloseAutoFocus={event => {
          onCloseAutoFocus?.(event)
          const active = document.activeElement
          // Preserve a newer interaction while the previous menu finishes closing.
          if (!event.defaultPrevented && active && active !== document.body && !(event.target as HTMLElement).contains(active)) event.preventDefault()
        }}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive" | "warning"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-inset={inset}
      data-variant={variant}
      className={cn(
        "fob-menu-item relative flex h-8 select-none items-center gap-2 rounded-[5px] px-2.5 outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[inset=true]:pl-8 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-current",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  indicator = "check",
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & { indicator?: "check" | "none" }) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      className={cn(
        "fob-menu-item relative flex h-8 select-none items-center gap-2 rounded-[5px] py-1.5 pr-2 pl-8 text-[12px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0",
        indicator === "none" && "pl-2.5",
        className,
      )}
      data-indicator={indicator}
      checked={checked}
      {...props}
    >
      {indicator === "check" && <span className="fob-menu-checkbox absolute left-2.5" aria-hidden>
        <DropdownMenuPrimitive.ItemIndicator>
          <Check className="size-3.5" weight="bold" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>}
      {children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup
function DropdownMenuRadioItem({ className, children, indicator = "check", emphasizeSelection = true, ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem> & { indicator?: "check" | "none"; emphasizeSelection?: boolean }) {
  return <DropdownMenuPrimitive.RadioItem
    className={cn("fob-menu-item relative flex h-8 select-none items-center gap-2 rounded-[5px] py-1.5 pr-2 pl-8 text-[12px] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0", indicator === "none" && "pl-2.5", className)}
    data-indicator={indicator}
    data-emphasize-selection={emphasizeSelection ? undefined : 'false'}
    {...props}
  >
    {indicator === "check" && <span className="absolute left-2.5 flex size-4 items-center justify-center"><DropdownMenuPrimitive.ItemIndicator><Check className="size-3.5" weight="bold" /></DropdownMenuPrimitive.ItemIndicator></span>}
    {children}
  </DropdownMenuPrimitive.RadioItem>
}

function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return (
    <DropdownMenuPrimitive.Label
      className={cn(
        "px-2.5 py-1.5 text-[11px] font-medium text-[var(--muted)]",
        className,
      )}
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-[var(--line)]", className)}
      {...props}
    />
  )
}

function DropdownMenuSubTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>) {
  return (
    <DropdownMenuPrimitive.SubTrigger
      className={cn(
        "fob-menu-item flex h-8 items-center gap-2 rounded-[5px] px-2.5 text-[12px] outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 [&>svg]:size-4 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    >
      {children}
      <CaretRight className="ml-auto size-3.5" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

const DropdownMenuSub = DropdownMenuPrimitive.Sub
function DropdownMenuSubContent({
  className,
  sideOffset = 6,
  alignOffset = -4,
  density = "regular",
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent> & { density?: "regular" | "compact" }) {
  const inheritedContainer = React.useContext(OverlayRootContext)
  const capturedContainer = React.useContext(DropdownMenuContainer)
  const container = inheritedContainer ?? capturedContainer ?? getOverlayRoot()
  return (
    <DropdownMenuPrimitive.Portal container={container}>
      <DropdownMenuPrimitive.SubContent
        data-density={density}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className={cn(
          "menu-surface z-50 min-w-40 overflow-hidden rounded-[8px] border bg-elevated p-1 text-[12px] text-[var(--ink)]",
          className,
        )}
        {...props}
        onEscapeKeyDown={event => { onEscapeKeyDown?.(event); keepSearchOpenOnEscape(event) }}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
}

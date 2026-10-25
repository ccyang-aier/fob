"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { getOverlayRoot, OverlayRootContext } from "@/lib/overlay-root"
import { cn } from "@/lib/utils"

const TooltipContainer = React.createContext<HTMLElement | undefined>(undefined)

function TooltipProvider({
  delayDuration = 380,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({ onOpenChange, ...props }: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const [container, setContainer] = React.useState<HTMLElement>()
  return <TooltipContainer.Provider value={container}>
    <TooltipPrimitive.Root data-slot="tooltip" {...props} onOpenChange={open => {
      if (open) setContainer(getOverlayRoot())
      onOpenChange?.(open)
    }} />
  </TooltipContainer.Provider>
}

function TooltipTrigger(
  props: React.ComponentProps<typeof TooltipPrimitive.Trigger>,
) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 7,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  const inheritedContainer = React.useContext(OverlayRootContext)
  const capturedContainer = React.useContext(TooltipContainer)
  const container = inheritedContainer ?? capturedContainer ?? getOverlayRoot()
  return (
    <TooltipPrimitive.Portal container={container}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 rounded-[5px] border border-white/10 bg-[var(--tooltip-bg)] px-2.5 py-1.5 text-[11px] font-medium text-[var(--tooltip-ink)] shadow-[0_1px_2px_rgba(16,20,24,0.18),0_6px_14px_-9px_rgba(16,20,24,0.46)] animate-in fade-in-0 zoom-in-95",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }

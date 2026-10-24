import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { ButtonLoading } from "./button-loading"
import loadingStyles from "./button-loading.module.css"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-[12px] font-medium outline-none transition-[color,background-color,border-color,box-shadow,transform] disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[color:var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-panel active:translate-y-px [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--accent)] text-[var(--accent-foreground)] shadow-[0_4px_12px_color-mix(in_srgb,var(--accent)_22%,transparent)] hover:bg-[var(--accent-strong)]",
        outline:
          "fob-action border border-[var(--control-border)] bg-panel text-[var(--ink)]",
        ghost:
          "fob-action text-[var(--muted-strong)]",
        subtle:
          "fob-action border border-[var(--control-border)] bg-[var(--surface-subtle)] text-[var(--muted-strong)]",
      },
      size: {
        default: "h-9 px-4",
        sm: "h-8 rounded-lg px-3 text-[11px]",
        icon: "size-9",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot : "button"
  const busy = loading || props["aria-busy"] === true || props["aria-busy"] === "true"

  return (
    <Comp
      data-slot="button"
      {...props}
      className={cn(buttonVariants({ variant, size, className }), busy && !asChild && loadingStyles.button)}
      aria-busy={busy || props["aria-busy"]}
      disabled={busy ? true : disabled}
    >
      {busy && !asChild ? (
        <>
          <span className={loadingStyles.content} data-slot="button-content">{children}</span>
          <span className={loadingStyles.overlay}><ButtonLoading /></span>
        </>
      ) : children}
    </Comp>
  )
}

export { Button, ButtonLoading, buttonVariants }

import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

import styles from "./button-loading.module.css"

function ButtonLoading({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      {...props}
      data-slot="button-loading"
      aria-hidden="true"
      className={cn(styles.dots, className)}
    >
      <span />
      <span />
      <span />
    </span>
  )
}

export { ButtonLoading }

"use client"

/**
 * 通用侧栏导航行（展开 30px / 折叠 32px 图标态）：hover 浅灰底条，
 * 图标默认采用深灰轮廓与浅灰局部填充，激活时保留同一造型和灰度。
 * 消费方：navigation-sidebar / settings-canvas。
 */

import type { ReactNode } from "react"
import type { Icon } from "@phosphor-icons/react"

import { cn } from "@/lib/utils"

export type SidebarRowItem = {
  id: string
  label: string
  icon: Icon
  /** 图标的固定着色（如收藏金星），不随导航激活改变 */
  iconClassName?: string
  /** 图标权重：默认 duotone，明确的功能图标可覆盖 */
  iconWeight?: "regular" | "duotone" | "fill"
  /** 行尾附加节点（时间戳、红点等），仅展开态渲染 */
  trailing?: ReactNode
}

export function NavButton({
  item,
  active,
  compact = false,
  nested = false,
  onSelect,
}: {
  item: SidebarRowItem
  active: boolean
  compact?: boolean
  nested?: boolean
  onSelect: (id: string) => void
}) {
  const Icon = item.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      aria-current={active ? "page" : undefined}
      aria-label={compact ? item.label : undefined}
      data-active={active}
      className={cn(
        "sidebar-nav-row group flex items-center rounded-[6px] text-[11px] leading-none outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]",
        compact
          ? "mx-auto size-8 justify-center"
          : cn("h-[30px] w-full gap-2 pr-2", nested ? "pl-5" : "pl-2"),
      )}
    >
      <Icon
        aria-hidden
        size={compact ? 18 : 16}
        weight={item.iconWeight ?? "duotone"}
        className={cn(
          "sidebar-nav-icon shrink-0",
          item.iconClassName,
        )}
      />
      {compact ? null : (
        <>
          <span className="sidebar-nav-label min-w-0 truncate">{item.label}</span>
          {item.trailing ? (
            <span className="ml-auto flex shrink-0 items-center">{item.trailing}</span>
          ) : null}
        </>
      )}
    </button>
  )
}

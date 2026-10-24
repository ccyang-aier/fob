"use client"

/**
 * 弹层宿主：桌面端窗口带透明边距（自绘阴影）时，Radix Portal 默认挂到
 * body 会把弹层浮到应用面板之外的透明区域。壳层启动时把面板根节点挂入，
 * tooltip / 下拉菜单等弹层统一收在面板内；Web 端无宿主时回落 body。
 */
let overlayRoot: HTMLElement | null = null

export function setOverlayRoot(node: HTMLElement | null): void {
  overlayRoot = node
}

export function getOverlayRoot(): HTMLElement | undefined {
  // 原生模态框处于 top layer；其菜单与提示也必须位于同一层。
  const modal = typeof document === "undefined" ? null : Array.from(document.querySelectorAll<HTMLDialogElement>("dialog:modal")).at(-1)
  if (modal) return modal
  const fullscreen = typeof document === "undefined" ? null : document.fullscreenElement
  if (fullscreen) return fullscreen as HTMLElement
  return overlayRoot ?? undefined
}

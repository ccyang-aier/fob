export type AssistantWindowPosition = { left: number; top: number };
export type AssistantWindowViewport = AssistantWindowPosition & { width: number; height: number };
export type AssistantWindowRect = AssistantWindowViewport;

export const ASSISTANT_WINDOW_STORAGE_KEY = 'fob.assistant.window.v1';

/** Fixed surfaces use visual viewport coordinates, including its pan offset. */
export function assistantWindowViewport(host: Window): AssistantWindowViewport {
  const viewport = host.visualViewport;
  return {
    left: viewport?.offsetLeft ?? 0,
    top: viewport?.offsetTop ?? 0,
    width: viewport?.width || host.innerWidth,
    height: viewport?.height || host.innerHeight,
  };
}

export function assistantWindowRect(viewport: AssistantWindowViewport, position?: AssistantWindowPosition | null): AssistantWindowRect {
  const gutter = viewport.width <= 600 ? 8 : 16;
  const insetX = Math.min(gutter, viewport.width / 2);
  const insetY = Math.min(gutter, viewport.height / 2);
  const width = Math.min(400, Math.max(0, viewport.width - insetX * 2));
  const height = Math.min(600, Math.max(0, viewport.height - insetY * 2));
  const minLeft = viewport.left + insetX, minTop = viewport.top + insetY;
  const maxLeft = viewport.left + viewport.width - width - insetX;
  const maxTop = viewport.top + viewport.height - height - insetY;
  return {
    left: Math.max(minLeft, Math.min(maxLeft, position?.left ?? viewport.left + viewport.width - width - 24)),
    top: Math.max(minTop, Math.min(maxTop, position?.top ?? viewport.top + 104)),
    width,
    height,
  };
}

/** Only the window position is persisted; chat data and transient viewport sizes are excluded. */
export function parseAssistantWindowPosition(value: string | null): AssistantWindowPosition | null {
  if (!value) return null;
  try {
    const position: unknown = JSON.parse(value);
    if (typeof position !== 'object' || position === null || !('left' in position) || !('top' in position)) return null;
    if (typeof position.left !== 'number' || !Number.isFinite(position.left) || typeof position.top !== 'number' || !Number.isFinite(position.top)) return null;
    return { left: position.left, top: position.top };
  } catch { return null; }
}

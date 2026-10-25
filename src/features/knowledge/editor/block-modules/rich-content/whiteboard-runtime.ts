import { parseWhiteboardScene } from '@fob/shared/knowledge/rich-content';
import type { ExcalidrawInitialDataState } from '@excalidraw/excalidraw/types';

let library: Promise<typeof import('@excalidraw/excalidraw')> | undefined;
export function loadWhiteboardLibrary() {
  (window as typeof window & { EXCALIDRAW_ASSET_PATH: string }).EXCALIDRAW_ASSET_PATH = `${window.location.origin}/vendor/excalidraw/`;
  return library ??= import('@excalidraw/excalidraw').catch(cause => { library = undefined; throw cause; });
}

export function whiteboardData(value: string): ExcalidrawInitialDataState {
  return (parseWhiteboardScene(value) ?? { elements: [], appState: {}, files: {} }) as unknown as ExcalidrawInitialDataState;
}

export async function whiteboardImage(value: string): Promise<string> {
  const library = await loadWhiteboardLibrary(), data = whiteboardData(value);
  const elements = library.restoreElements(data.elements ?? [], null);
  if (!elements.some(element => !element.isDeleted)) return '';
  const svg = await library.exportToSvg({ elements, appState: { ...data.appState, exportBackground: true, exportEmbedScene: false }, files: data.files ?? {}, exportPadding: 16 });
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.outerHTML)}`;
}

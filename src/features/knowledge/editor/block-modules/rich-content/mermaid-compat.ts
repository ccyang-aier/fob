import { mermaidPalette } from './mermaid-theme';

let engine: Promise<typeof import('mermaid')> | undefined;
let queue: Promise<unknown> = Promise.resolve();

/** Preserve Mermaid-only diagram types using the same upstream palette and restrained visual roles. */
export function renderCompatibleMermaid(id: string, source: string, dark: boolean): Promise<string> {
  const result = queue.then(async () => {
    const renderer = await (engine ??= import('mermaid').catch(cause => { engine = undefined; throw cause; }));
    const color = mermaidPalette(dark);
    const surface = color.surface ?? `color-mix(in srgb, ${color.fg} 3%, ${color.bg})`;
    const border = color.border ?? `color-mix(in srgb, ${color.fg} 20%, ${color.bg})`;
    renderer.default.initialize({
      startOnLoad: false, securityLevel: 'strict', theme: 'base', look: 'classic', htmlLabels: false,
      suppressErrorRendering: true, maxTextSize: 50_000,
      fontFamily: 'Inter, system-ui, "Microsoft YaHei UI", sans-serif',
      themeVariables: {
        darkMode: dark, background: color.bg, fontSize: '13px', fontWeight: '500', radius: 0,
        useGradient: false, dropShadow: 'none', primaryColor: color.bg, primaryTextColor: color.fg,
        primaryBorderColor: color.border ?? color.line ?? color.fg, textColor: color.fg,
        lineColor: color.line ?? color.fg, defaultLinkColor: color.line ?? color.fg,
        mainBkg: color.bg, nodeBorder: color.border ?? color.line ?? color.fg, nodeTextColor: color.fg,
        clusterBkg: color.bg, clusterBorder: color.line ?? color.fg, titleColor: color.fg,
        edgeLabelBackground: color.bg, secondaryColor: color.bg, secondaryTextColor: color.fg,
        tertiaryColor: color.bg, tertiaryTextColor: color.fg,
      },
      themeCSS: `.node rect,.node circle,.node ellipse,.node polygon,.node path{fill:${surface};stroke:${border}}
        .cluster rect{fill:${color.bg};stroke:${border}}`,
    });
    return (await renderer.default.render(id, source)).svg;
  });
  queue = result.catch(() => undefined);
  return result;
}

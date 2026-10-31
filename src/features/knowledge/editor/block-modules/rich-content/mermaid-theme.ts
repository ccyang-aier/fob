import type { MermaidConfig } from 'mermaid';

const fontFamily = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif';
const palettes = {
  light: { background: '#ffffff', node: '#eef4fb', border: '#758ba6', text: '#24364b', line: '#72849a', secondary: '#f5f7fa', tertiary: '#f0f6f6', group: '#f8fafc', groupBorder: '#c2cddc', note: '#fff7e3', noteBorder: '#b99a58', noteText: '#655127' },
  dark: { background: '#181818', node: '#233247', border: '#6d86a5', text: '#e1eaf6', line: '#9bacbf', secondary: '#292e36', tertiary: '#253b3d', group: '#1d232d', groupBorder: '#465468', note: '#3b3425', noteBorder: '#9c8659', noteText: '#eddeb4' },
};

/** Content colors live in the exported SVG, so previews and standalone exports share the same style. */
export function mermaidTheme(dark: boolean): MermaidConfig {
  const color = palettes[dark ? 'dark' : 'light'];
  return {
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    look: 'classic',
    fontFamily,
    htmlLabels: false,
    suppressErrorRendering: true,
    maxTextSize: 50_000,
    flowchart: { htmlLabels: false, curve: 'basis', nodeSpacing: 36, rankSpacing: 52, padding: 14 },
    themeVariables: {
      darkMode: dark,
      background: color.background,
      fontFamily,
      fontSize: '14px',
      fontWeight: '500',
      radius: 6,
      strokeWidth: 1,
      useGradient: false,
      dropShadow: 'none',
      primaryColor: color.node,
      primaryBorderColor: color.border,
      primaryTextColor: color.text,
      secondaryColor: color.secondary,
      secondaryBorderColor: color.border,
      secondaryTextColor: color.text,
      tertiaryColor: color.tertiary,
      tertiaryBorderColor: color.border,
      tertiaryTextColor: color.text,
      textColor: color.text,
      lineColor: color.line,
      defaultLinkColor: color.line,
      mainBkg: color.node,
      nodeBorder: color.border,
      nodeTextColor: color.text,
      clusterBkg: color.group,
      clusterBorder: color.groupBorder,
      titleColor: color.text,
      edgeLabelBackground: color.background,
      actorBkg: color.node,
      actorBorder: color.border,
      actorTextColor: color.text,
      actorLineColor: color.line,
      signalColor: color.line,
      signalTextColor: color.text,
      labelBoxBkgColor: color.secondary,
      labelBoxBorderColor: color.border,
      labelTextColor: color.text,
      activationBkgColor: color.secondary,
      activationBorderColor: color.border,
      noteBkgColor: color.note,
      noteBorderColor: color.noteBorder,
      noteTextColor: color.noteText,
    },
  };
}

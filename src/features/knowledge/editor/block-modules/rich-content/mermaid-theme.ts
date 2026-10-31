import type { MermaidConfig } from 'mermaid';
import type { MermaidTheme } from '@fob/shared/knowledge/rich-content';

const fontFamily = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif';
const surfaces = {
  light: { background: '#ffffff', group: '#f8fafc', groupBorder: '#c2cddc', note: '#fff7e3', noteBorder: '#b99a58', noteText: '#655127' },
  dark: { background: '#181818', group: '#1d232d', groupBorder: '#465468', note: '#3b3425', noteBorder: '#9c8659', noteText: '#eddeb4' },
};
const accents = {
  blue: {
    light: { node: '#eef4fb', border: '#758ba6', text: '#24364b', line: '#72849a', secondary: '#f5f7fa', tertiary: '#f0f6f6' },
    dark: { node: '#233247', border: '#6d86a5', text: '#e1eaf6', line: '#9bacbf', secondary: '#292e36', tertiary: '#253b3d' },
  },
  green: {
    light: { node: '#edf7f1', border: '#688f79', text: '#254636', line: '#668572', secondary: '#f2f7f4', tertiary: '#e7f2ed' },
    dark: { node: '#213a2e', border: '#6d9b81', text: '#def0e5', line: '#91b79f', secondary: '#283930', tertiary: '#263e34' },
  },
  amber: {
    light: { node: '#fff3e5', border: '#b18b57', text: '#65451f', line: '#9b815e', secondary: '#fbf6ee', tertiary: '#f5eddf' },
    dark: { node: '#3e3021', border: '#b19770', text: '#f3e4d0', line: '#c0a887', secondary: '#393127', tertiary: '#453625' },
  },
  violet: {
    light: { node: '#f3effb', border: '#9180b4', text: '#45335f', line: '#8b7aa4', secondary: '#f7f4fb', tertiary: '#ede7f6' },
    dark: { node: '#30273f', border: '#9a85b8', text: '#ece3f6', line: '#b09bc8', secondary: '#332c3e', tertiary: '#3a2e48' },
  },
  mono: {
    light: { node: '#f5f5f5', border: '#8a8a8a', text: '#303030', line: '#777777', secondary: '#fafafa', tertiary: '#ededed' },
    dark: { node: '#2b2b2b', border: '#858585', text: '#ececec', line: '#a0a0a0', secondary: '#313131', tertiary: '#383838' },
  },
};

export function mermaidPalette(theme: MermaidTheme, dark: boolean) {
  const mode = dark ? 'dark' : 'light';
  return { ...surfaces[mode], ...accents[theme][mode] };
}

/** Content colors live in the exported SVG, so previews and standalone exports share the same style. */
export function mermaidTheme(dark: boolean, theme: MermaidTheme = 'blue'): MermaidConfig {
  const color = mermaidPalette(theme, dark);
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

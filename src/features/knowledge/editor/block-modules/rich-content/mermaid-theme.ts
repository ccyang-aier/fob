import type { MermaidConfig } from 'mermaid';
import type { MermaidTheme } from '@fob/shared/knowledge/rich-content';

const fontFamily = 'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif';
const surfaces = {
  light: { background: '#ffffff', note: '#fff7e3', noteBorder: '#b99a58', noteText: '#655127' },
  dark: { background: '#181818', note: '#3b3425', noteBorder: '#9c8659', noteText: '#eddeb4' },
};
const accents = {
  blue: {
    light: {
      node: '#eef4fb', border: '#758ba6', text: '#24364b', line: '#72849a',
      decision: '#fff0d6', decisionBorder: '#b78540', decisionText: '#69451d',
      group: '#f0f7f6', groupBorder: '#b7d0cc', groupText: '#37595a',
    },
    dark: {
      node: '#233247', border: '#6d86a5', text: '#e1eaf6', line: '#9bacbf',
      decision: '#44351e', decisionBorder: '#bc9557', decisionText: '#f5dfae',
      group: '#1e2c2c', groupBorder: '#465e5b', groupText: '#c2dbd7',
    },
  },
  green: {
    light: {
      node: '#edf7f1', border: '#688f79', text: '#254636', line: '#668572',
      decision: '#efe8fb', decisionBorder: '#9880b5', decisionText: '#503b70',
      group: '#f6f7ed', groupBorder: '#ccd1ac', groupText: '#525b32',
    },
    dark: {
      node: '#213a2e', border: '#6d9b81', text: '#def0e5', line: '#91b79f',
      decision: '#382d49', decisionBorder: '#a58bbf', decisionText: '#eadcf8',
      group: '#2a2e22', groupBorder: '#626b47', groupText: '#dce5bc',
    },
  },
  amber: {
    light: {
      node: '#fff3e5', border: '#b18b57', text: '#65451f', line: '#9b815e',
      decision: '#e8f1fc', decisionBorder: '#7d9cbd', decisionText: '#2f5274',
      group: '#eff6f0', groupBorder: '#bbd1be', groupText: '#3c5c45',
    },
    dark: {
      node: '#3e3021', border: '#b19770', text: '#f3e4d0', line: '#c0a887',
      decision: '#23374d', decisionBorder: '#7e9ebd', decisionText: '#dceaff',
      group: '#232e27', groupBorder: '#526b59', groupText: '#c7dfca',
    },
  },
  violet: {
    light: {
      node: '#f3effb', border: '#9180b4', text: '#45335f', line: '#8b7aa4',
      decision: '#ffefdd', decisionBorder: '#b18b61', decisionText: '#704a2b',
      group: '#eff6f7', groupBorder: '#b7ced0', groupText: '#3a5860',
    },
    dark: {
      node: '#30273f', border: '#9a85b8', text: '#ece3f6', line: '#b09bc8',
      decision: '#46321f', decisionBorder: '#b6946d', decisionText: '#f6dfc1',
      group: '#222e32', groupBorder: '#4b646c', groupText: '#c6dde0',
    },
  },
  mono: {
    light: {
      node: '#f5f5f5', border: '#8a8a8a', text: '#303030', line: '#777777',
      decision: '#e5e5e5', decisionBorder: '#7a7a7a', decisionText: '#303030',
      group: '#fafafa', groupBorder: '#c6c6c6', groupText: '#555555',
    },
    dark: {
      node: '#2b2b2b', border: '#858585', text: '#ececec', line: '#a0a0a0',
      decision: '#414141', decisionBorder: '#a1a1a1', decisionText: '#f5f5f5',
      group: '#232323', groupBorder: '#5a5a5a', groupText: '#c5c5c5',
    },
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
    // Classic renders decisions as polygons; keep these SVG rules below explicit source styles.
    themeCSS: `
      .node > polygon.label-container { fill: ${color.decision}; stroke: ${color.decisionBorder}; }
      .node:has(> polygon.label-container) .label text { fill: ${color.decisionText}; }
      .node:has(> polygon.label-container) .nodeLabel { color: ${color.decisionText}; }
      .cluster-label text { fill: ${color.groupText}; }
      .cluster-label .nodeLabel { color: ${color.groupText}; }
    `,
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
      secondaryColor: color.decision,
      secondaryBorderColor: color.decisionBorder,
      secondaryTextColor: color.decisionText,
      tertiaryColor: color.group,
      tertiaryBorderColor: color.groupBorder,
      tertiaryTextColor: color.groupText,
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
      labelBoxBkgColor: color.decision,
      labelBoxBorderColor: color.decisionBorder,
      labelTextColor: color.decisionText,
      activationBkgColor: color.decision,
      activationBorderColor: color.decisionBorder,
      noteBkgColor: color.note,
      noteBorderColor: color.noteBorder,
      noteTextColor: color.noteText,
    },
  };
}

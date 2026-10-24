'use client';

import { getLocale, type Locale } from './i18n/locale';
import { translate } from './i18n/messages';
import { appearanceMessages } from './i18n/appearance.messages';

/**
 * 外观偏好：主题（浅色 / 深色 / 跟随系统）与字体（界面 / 代码）。
 * 状态落在 html 的 dataset（主题、字体族）与 CSS 变量（字号）上，
 * 由 globals.css 消费；localStorage 单键持久化，首帧由 layout 内联脚本应用避免闪色。
 */

// ── 主题 ───────────────────────────────────────────────────────────

export const THEME_PREFS = ['light', 'dark', 'system'] as const;
export type ThemePref = (typeof THEME_PREFS)[number];
export type ResolvedTheme = 'light' | 'dark';

export function resolveTheme(pref: ThemePref): ResolvedTheme {
  if (pref !== 'system') return pref;
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// ── 字体目录（预览栈与 globals.css 的属性映射保持同步） ─────────────

export const UI_FONT_IDS = [
  'default',
  'native',
  'lxgw-wenkai',
  'source-han-sans',
  'source-han-serif',
  'mono',
] as const;
export type UiFontId = (typeof UI_FONT_IDS)[number];

export const uiFontOptions: Array<{ id: UiFontId; stack: string }> = [
  {
    id: 'default',
    stack:
      '"Inter Variable", "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", system-ui, sans-serif',
  },
  {
    id: 'native',
    stack:
      'system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei UI", "Noto Sans CJK SC", sans-serif',
  },
  {
    id: 'lxgw-wenkai',
    stack: '"LXGW WenKai", "霞鹜文楷", "STKaiti", "KaiTi", serif',
  },
  {
    id: 'source-han-sans',
    stack:
      '"Source Han Sans SC", "Noto Sans CJK SC", "Noto Sans SC", "Microsoft YaHei UI", sans-serif',
  },
  {
    id: 'source-han-serif',
    stack: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", serif',
  },
  {
    id: 'mono',
    stack: 'var(--font-code)',
  },
];

export const CODE_FONT_IDS = [
  'default',
  'cascadia',
  'jetbrains',
  'maple',
  'sarasa',
  'fira-code',
  'source-code-pro',
  'iosevka',
  'ibm-plex-mono',
  'consolas',
] as const;
export type CodeFontId = (typeof CODE_FONT_IDS)[number];

export const codeFontOptions: Array<{ id: CodeFontId; label: string; stack: string }> = [
  {
    id: 'default',
    label: 'Maple Mono',
    stack:
      '"Maple Mono", "Maple Mono NF CN", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  {
    id: 'cascadia',
    label: 'Cascadia Code',
    stack: '"Cascadia Code", "Cascadia Mono", ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  {
    id: 'jetbrains',
    label: 'JetBrains Mono',
    stack: '"JetBrains Mono", "Cascadia Code", ui-monospace, SFMono-Regular, Consolas, monospace',
  },
  {
    id: 'maple',
    label: 'Maple Mono',
    stack:
      '"Maple Mono", "Maple Mono NF CN", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  },
  {
    id: 'sarasa',
    label: 'Sarasa Mono',
    stack: '"Sarasa Mono SC", "Sarasa Fixed SC", "Noto Sans Mono CJK SC", ui-monospace, monospace',
  },
  {
    id: 'fira-code',
    label: 'Fira Code',
    stack: '"Fira Code", "JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    stack: '"Source Code Pro", "Cascadia Code", ui-monospace, monospace',
  },
  {
    id: 'iosevka',
    label: 'Iosevka',
    stack: 'Iosevka, "JetBrains Mono", ui-monospace, monospace',
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    stack: '"IBM Plex Mono", "Source Code Pro", ui-monospace, monospace',
  },
  {
    id: 'consolas',
    label: 'Consolas',
    stack: 'Consolas, "Liberation Mono", "Courier New", monospace',
  },
];

export function getThemePrefLabels(locale: Locale = getLocale()): Record<ThemePref, string> {
  return Object.fromEntries(
    THEME_PREFS.map((id) => [id, translate(appearanceMessages, id, undefined, locale)]),
  ) as Record<ThemePref, string>;
}
export function getUiFontOptions(locale: Locale = getLocale()) {
  return uiFontOptions.map((option) => ({
    ...option,
    label: translate(appearanceMessages, option.id, undefined, locale),
  }));
}
export function getCodeFontOptions(locale: Locale = getLocale()) {
  return codeFontOptions.map((option) => ({
    ...option,
    label:
      option.id === 'default'
        ? translate(appearanceMessages, 'codeDefault', undefined, locale)
        : option.id === 'sarasa'
          ? translate(appearanceMessages, 'sarasa', undefined, locale)
          : option.label,
  }));
}
export const FONT_SIZE_RANGES = {
  ui: { min: 12, max: 16 },
  code: { min: 11, max: 15 },
} as const;

// ── 偏好模型 ───────────────────────────────────────────────────────

export type AppearancePrefs = {
  theme: ThemePref;
  uiFont: UiFontId;
  uiFontSize: number;
  codeFont: CodeFontId;
  codeFontSize: number;
};

export const APPEARANCE_DEFAULTS: AppearancePrefs = {
  theme: 'light',
  uiFont: 'default',
  uiFontSize: 13,
  codeFont: 'maple',
  codeFontSize: 12,
};

const STORAGE_KEY = 'fob.appearance';

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

function sizeOf(value: unknown, range: { min: number; max: number }, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= range.min && n <= range.max ? Math.round(n) : fallback;
}

export function readAppearancePrefs(): AppearancePrefs {
  if (typeof window === 'undefined') return APPEARANCE_DEFAULTS;
  let raw: unknown = null;
  try {
    raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null');
  } catch {
    raw = null;
  }
  const saved = (raw ?? {}) as Record<string, unknown>;
  return {
    theme: oneOf(saved.theme, THEME_PREFS, APPEARANCE_DEFAULTS.theme),
    uiFont: oneOf(saved.uiFont, UI_FONT_IDS, APPEARANCE_DEFAULTS.uiFont),
    uiFontSize: sizeOf(saved.uiFontSize, FONT_SIZE_RANGES.ui, APPEARANCE_DEFAULTS.uiFontSize),
    codeFont: oneOf(saved.codeFont, CODE_FONT_IDS, APPEARANCE_DEFAULTS.codeFont),
    codeFontSize: sizeOf(
      saved.codeFontSize,
      FONT_SIZE_RANGES.code,
      APPEARANCE_DEFAULTS.codeFontSize,
    ),
  };
}

// ── 应用 ───────────────────────────────────────────────────────────

let current: AppearancePrefs = APPEARANCE_DEFAULTS;
let snapshotInitialized = false;
let systemListenerBound = false;
const listeners = new Set<() => void>();

function applyResolvedTheme(resolved: ResolvedTheme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

/** 跟随系统：系统深浅色变化时实时重解析（监听常驻，仅在 system 偏好下生效） */
function ensureSystemListener(): void {
  if (systemListenerBound || typeof window === 'undefined') return;
  systemListenerBound = true;
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (current.theme !== 'system') return;
    applyResolvedTheme(resolveTheme('system'));
    for (const listener of listeners) listener();
  });
}

export function applyAppearancePrefs(prefs: AppearancePrefs): void {
  current = prefs;
  if (typeof window === 'undefined') return;

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));

  applyResolvedTheme(resolveTheme(prefs.theme));

  const root = document.documentElement;
  const fontAttrs: Array<[name: string, value: string, isDefault: boolean]> = [
    ['uiFont', prefs.uiFont, prefs.uiFont === 'default'],
    ['codeFont', prefs.codeFont, prefs.codeFont === 'default'],
  ];
  for (const [name, value, isDefault] of fontAttrs) {
    if (isDefault) delete root.dataset[name];
    else root.dataset[name] = value;
  }
  root.style.setProperty('--ui-size', `${prefs.uiFontSize}px`);
  root.style.setProperty('--code-size', `${prefs.codeFontSize}px`);
  ensureSystemListener();
  for (const listener of listeners) listener();
}

// ── 外部存储（useSyncExternalStore） ────────────────────────────────

/** 订阅外观偏好变化（applyAppearancePrefs 时通知） */
export function subscribeAppearance(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** 客户端快照：首次读取本地持久化偏好，之后缓存 */
export function getAppearanceSnapshot(): AppearancePrefs {
  if (!snapshotInitialized) {
    current = readAppearancePrefs();
    snapshotInitialized = true;
  }
  return current;
}

/** 服务端快照：默认值（保持水合契约） */
export function getAppearanceServerSnapshot(): AppearancePrefs {
  return APPEARANCE_DEFAULTS;
}

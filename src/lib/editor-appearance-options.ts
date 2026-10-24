import { getLocale, type Locale } from './i18n/locale';
import { translate } from './i18n/messages';
import { documentAppearanceMessages } from './i18n/document-appearance.messages';

export const documentFonts = [
  { id: 'default', family: 'var(--font-sans)' },
  { id: 'wenkai', family: '"Fob Document WenKai", serif' },
  { id: 'wenkai-screen', family: '"Fob Document WenKai Screen", serif' },
  { id: 'zhenkai', family: '"Fob Document ZhenKai", serif' },
  { id: 'serif', family: '"Noto Serif SC", serif' },
  { id: 'mono', family: 'var(--font-code), monospace' },
] as const;

export const documentSizes = [
  { id: 'extra-small', pixels: 14 },
  { id: 'small', pixels: 15 },
  { id: 'standard', pixels: 16 },
  { id: 'large', pixels: 18 },
  { id: 'extra-large', pixels: 20 },
] as const;

export const documentWidth = { min: 40, max: 100, default: 80 };
export const documentCodeFonts = [
  { id: 'default', family: 'var(--font-code)' },
  { id: 'jetbrains-mono', label: 'JetBrains Mono', family: '"JetBrains Mono", var(--font-code)' },
  { id: 'fira-code', label: 'Fira Code', family: '"Fira Code", var(--font-code)' },
  {
    id: 'source-code-pro',
    label: 'Source Code Pro',
    family: '"Source Code Pro", var(--font-code)',
  },
  { id: 'ibm-plex-mono', label: 'IBM Plex Mono', family: '"IBM Plex Mono", var(--font-code)' },
] as const;
export const documentLineHeights = [1.5, 1.8, 2] as const;
export const documentParagraphSpacings = [
  { id: 'compact', pixels: 8 },
  { id: 'standard', pixels: 18 },
  { id: 'relaxed', pixels: 28 },
] as const;

export function getDocumentAppearanceOptions(locale: Locale = getLocale()) {
  return {
    fonts: documentFonts.map((option) => ({
      ...option,
      label: translate(documentAppearanceMessages, `font.${option.id}`, undefined, locale),
    })),
    sizes: documentSizes.map((option) => ({
      ...option,
      label: translate(documentAppearanceMessages, `size.${option.id}`, undefined, locale),
    })),
    codeFonts: documentCodeFonts.map((option) => ({
      ...option,
      label:
        option.id === 'default'
          ? translate(documentAppearanceMessages, 'code.default', undefined, locale)
          : option.label,
    })),
    spacings: documentParagraphSpacings.map((option) => ({
      ...option,
      label: translate(documentAppearanceMessages, `spacing.${option.id}`, undefined, locale),
    })),
  };
}

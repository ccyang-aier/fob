'use client';

import { MERMAID_THEMES, isMermaidTheme, type MermaidTheme } from '@fob/shared/knowledge/rich-content';
import { Palette } from '@/components/icons';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { GraphicToolButton } from './graphic-tool-button';
import { mermaidPalette } from './mermaid-theme';
import { richMessages } from './messages';
import styles from './rich-content.module.css';

const labels = { blue: 'themeBlue', green: 'themeGreen', amber: 'themeAmber', violet: 'themeViolet', mono: 'themeMono' } as const;

export function MermaidThemeMenu({ value, dark, onChange }: { value: MermaidTheme; dark: boolean; onChange: (theme: MermaidTheme) => void }) {
  const { t } = useTranslation(richMessages);
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild><GraphicToolButton label={t('diagramTheme')}><Palette size={16} aria-hidden /></GraphicToolButton></DropdownMenuTrigger>
    <DropdownMenuContent align="end" density="compact" aria-label={t('diagramTheme')}>
      <DropdownMenuRadioGroup value={value} onValueChange={next => { if (isMermaidTheme(next)) onChange(next); }}>
        {MERMAID_THEMES.map(theme => {
          const color = mermaidPalette(theme, dark);
          return <DropdownMenuRadioItem key={theme} value={theme} data-mermaid-theme={theme}>
            <span className={styles.diagramThemeSwatch} style={{ backgroundColor: color.node, borderColor: color.border }} aria-hidden />
            {t(labels[theme])}
          </DropdownMenuRadioItem>;
        })}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

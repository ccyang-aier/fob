'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-appearance-menu.messages';
import { useState, type KeyboardEvent } from 'react';
import { SlidersHorizontal } from '@/components/icons';
import {
  AppearanceSelect,
  AppearanceSizeControl,
  AppearanceWidthControl,
} from '@/components/editor-appearance-controls';
import {
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { documentLineHeights, getDocumentAppearanceOptions } from '@/lib/editor-appearance-options';
import { useDocumentAppearance } from './document-appearance';
import styles from './document-appearance-menu.module.css';

function navigateControls(event: KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab' || (event.target as Element).closest('[data-editor-appearance-dropdown]'))
    return;
  event.preventDefault();
  event.stopPropagation();
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>('input, button:not(:disabled)'),
  );
  const index = controls.indexOf(document.activeElement as HTMLElement);
  controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus();
}

export function DocumentAppearanceMenu({ triggerClassName }: { triggerClassName: string }) {
  const { locale, t: knowledgeT } = useTranslation(knowledgeMessages);
  const options = getDocumentAppearanceOptions(locale);

  const { appearance, update } = useDocumentAppearance();
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        className={triggerClassName}
        onClick={(event) => {
          if (open) {
            event.preventDefault();
            setOpen(false);
          }
        }}
      >
        <SlidersHorizontal aria-hidden />
        {knowledgeT('appearance')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent
        className={styles.panel}
        onKeyDownCapture={navigateControls}
        aria-label={knowledgeT('appearance')}
        onFocusOutside={(event) => {
          if ((event.target as Element)?.closest('[data-editor-appearance-dropdown]'))
            event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if ((event.target as Element)?.closest('[data-editor-appearance-dropdown]'))
            event.preventDefault();
        }}
      >
        <div className={styles.header} data-menu-reveal>
          <h2 className={styles.heading}>{knowledgeT('appearance')}</h2>
        </div>
        <div className={styles.controls}>
          <AppearanceWidthControl
            value={appearance.width}
            onChange={(width) => update({ width })}
          />
          <AppearanceSelect
            label={knowledgeT('font')}
            value={appearance.font}
            options={options.fonts}
            onChange={(font) => update({ font })}
          />
          <AppearanceSizeControl value={appearance.size} onChange={(size) => update({ size })} />
          <AppearanceSelect
            label={knowledgeT('codeFont')}
            value={appearance.codeFont}
            options={options.codeFonts}
            onChange={(codeFont) => update({ codeFont })}
          />
          <AppearanceSelect
            label={knowledgeT('lineHeight')}
            value={appearance.lineHeight}
            options={documentLineHeights.map((id) => ({
              id,
              label: knowledgeT('value', { v0: id }),
            }))}
            onChange={(lineHeight) => update({ lineHeight })}
          />
          <AppearanceSelect
            label={knowledgeT('paragraphSpacing')}
            value={appearance.paragraphSpacing}
            options={options.spacings}
            onChange={(paragraphSpacing) => update({ paragraphSpacing })}
          />
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

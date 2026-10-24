'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/view-switcher.messages';

import { SquaresFour, Table } from '@phosphor-icons/react';
import { Button } from './button';
import styles from './view-switcher.module.css';

export type ViewMode = 'list' | 'grid';

export function ViewSwitcher({
  value,
  onValueChange,
  listLabel,
  gridLabel,
}: {
  value: ViewMode;
  onValueChange: (value: ViewMode) => void;
  listLabel?: string;
  gridLabel?: string;
}) {
  const uiText = useTranslation(messages).t;
  return (
    <div className={styles.switcher} role="group" aria-label={uiText('浏览方式')}>
      {(['list', 'grid'] as const).map((mode) => {
        const Icon = mode === 'list' ? Table : SquaresFour;
        return (
          <Button
            key={mode}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={
              mode === 'list'
                ? (listLabel ?? uiText('列表视图'))
                : (gridLabel ?? uiText('卡片视图'))
            }
            aria-pressed={value === mode}
            onClick={() => onValueChange(mode)}
            className={styles.option}
          >
            <Icon data-icon="inline-start" size={16} weight={value === mode ? 'fill' : 'regular'} />
          </Button>
        );
      })}
    </div>
  );
}

'use client';

import type { NodeViewProps } from '@tiptap/react';
import { BlockAlignCenter, BlockAlignLeft, BlockAlignRight } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { messages } from './block-alignment-menu.messages';

const choices = [
  { value: 'left', label: 'left', icon: BlockAlignLeft },
  { value: 'center', label: 'center', icon: BlockAlignCenter },
  { value: 'right', label: 'right', icon: BlockAlignRight },
] as const;

export function BlockAlignmentMenu({ props }: { props: NodeViewProps }) {
  const { t } = useTranslation(messages);
  const align = String(props.node.attrs.align);
  const Icon = choices.find(choice => choice.value === align)?.icon ?? BlockAlignCenter;
  return <DropdownMenu modal={false}>
    <Tooltip><TooltipTrigger asChild>
      <DropdownMenuTrigger className="fob-action" data-surface="plain" aria-label={t('arrange')}>
        <Icon size={16} aria-hidden />
      </DropdownMenuTrigger>
    </TooltipTrigger><TooltipContent side="top">{t('arrange')}</TooltipContent></Tooltip>
    <DropdownMenuContent align="end" className="w-36 min-w-0" density="compact" aria-label={t('arrange')}>
      <DropdownMenuRadioGroup value={align} onValueChange={value => {
        if (!props.editor.isDestroyed && props.editor.isEditable && choices.some(choice => choice.value === value)) props.updateAttributes({ align: value });
      }}>
        {choices.map(({ value, label, icon: ItemIcon }) => <DropdownMenuRadioItem key={value} value={value} indicator="none">
          <ItemIcon size={14} aria-hidden />{t(label)}
        </DropdownMenuRadioItem>)}
      </DropdownMenuRadioGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

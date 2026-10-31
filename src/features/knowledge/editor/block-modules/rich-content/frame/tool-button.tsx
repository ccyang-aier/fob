'use client';

import type { ButtonHTMLAttributes } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import styles from './styles.module.css';

export function GraphicToolButton({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return <Tooltip>
    <TooltipTrigger asChild><button {...props} type="button" className={`fob-action ${styles.iconButton}`} data-surface="plain" aria-label={label}>{children}</button></TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>;
}

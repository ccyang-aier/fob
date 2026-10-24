import type { ComponentProps } from 'react';
import type { LucideIcon } from 'lucide-react';
import { motion, type Variants } from 'motion/react';
import { ButtonLoading } from '@/components/ui/button-loading';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import styles from './companion-widget.module.css';

const itemMotion: Variants = {
  closed: { opacity: 0, y: 6, transition: { duration: .1 } },
  open: { opacity: 1, y: 0, transition: { duration: .18, ease: [.22, 1, .36, 1] } },
};

/** Radix slot props and the React 19 ref reach the actual button through the tooltip. */
export function CompanionToolButton({ icon: Icon, label, loading = false, className, disabled, ...props }: ComponentProps<'button'> & {
  icon: LucideIcon;
  label: string;
  loading?: boolean;
}) {
  return (
    <motion.div className={styles.toolItem} variants={itemMotion}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button {...props} type="button" className={cn('fob-action', styles.tool, className)} aria-label={label} aria-busy={loading || undefined} disabled={disabled || loading}>
            <span className={styles.glyph}>{loading ? <ButtonLoading /> : <Icon size={18} strokeWidth={1.65} aria-hidden />}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="left" sideOffset={12}>{label}</TooltipContent>
      </Tooltip>
    </motion.div>
  );
}

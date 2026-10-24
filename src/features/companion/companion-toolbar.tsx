import { Heart, Moon, Sparkle } from 'lucide-react';
import { motion, useIsPresent, useReducedMotion, type Variants } from 'motion/react';
import { useTranslation } from '@/lib/i18n/react';
import { CompanionActionMenu } from './companion-action-menu';
import { CompanionToolButton } from './companion-tool-button';
import { messages, type CompanionAction } from './companion.messages';
import type { CompanionState } from './companion-runtime';
import styles from './companion-widget.module.css';

const railMotion: Variants = {
  closed: { opacity: 0, y: 10, clipPath: 'inset(100% -50% -12% -50% round 24px)', transition: { duration: .18, ease: [.4, 0, 1, 1] } },
  open: {
    opacity: 1, y: 0, clipPath: 'inset(-12% -50% -12% -50% round 24px)',
    transition: { duration: .38, ease: [.2, .8, .2, 1], delayChildren: .06, staggerChildren: .035, staggerDirection: -1 },
  },
};

export function CompanionToolbar({ id, state, onFeed, onAction }: {
  id: string;
  state: CompanionState;
  onFeed: () => void;
  onAction: (action: CompanionAction) => void;
}) {
  const { t } = useTranslation(messages);
  const present = useIsPresent();
  const reducedMotion = useReducedMotion();
  return (
    <motion.div
      id={id}
      className={styles.rail}
      role="toolbar"
      aria-label={t('工具栏')}
      aria-orientation="vertical"
      aria-hidden={!present || undefined}
      inert={!present}
      variants={railMotion}
      initial={reducedMotion ? false : 'closed'}
      animate="open"
      exit={reducedMotion ? undefined : 'closed'}
    >
      <CompanionToolButton icon={Sparkle} label={t('喂糖')} disabled={state.busy} loading={state.busy && state.label === 'CANDY!'} onClick={onFeed} />
      <span className={styles.divider} role="separator" />
      <CompanionToolButton icon={Heart} label={t('抚摸')} disabled={state.busy} onClick={() => onAction('happy')} />
      <CompanionActionMenu group="expression" busy={state.busy} onAction={onAction} />
      <CompanionActionMenu group="motion" busy={state.busy} onAction={onAction} />
      <CompanionToolButton icon={Moon} label={t('睡眠')} disabled={state.busy} onClick={() => onAction('sleep')} />
    </motion.div>
  );
}

import { ArrowUp, CircleHelp, Eye, EyeClosed, Heart, Moon, Orbit, Smile, SmilePlus, Sparkles, WandSparkles } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n/react';
import { companionExpressions, companionMotions, messages, type CompanionAction } from './companion.messages';
import { CompanionToolButton } from './companion-tool-button';
import styles from './companion-widget.module.css';

const groups = {
  expression: { label: '表情', Icon: Smile, actions: companionExpressions },
  motion: { label: '动作', Icon: WandSparkles, actions: companionMotions },
} as const;
const actionIcons = { blink: Eye, wink: EyeClosed, happy: Heart, drowsy: Moon, curious: CircleHelp, surprised: Eye, shy: SmilePlus, dizzy: Orbit, sleep: Moon, hopAct: ArrowUp, poof: Sparkles };

export function CompanionActionMenu({ group, busy, onAction }: {
  group: keyof typeof groups;
  busy: boolean;
  onAction: (action: CompanionAction) => void;
}) {
  const { t } = useTranslation(messages);
  const { label, Icon, actions } = groups[group];
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <CompanionToolButton icon={Icon} label={t(label)} />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="left" align="end" sideOffset={12} collisionPadding={12} className={styles.menu}>
        {actions.map(([action, key]) => {
          const ActionIcon = actionIcons[action];
          return <DropdownMenuItem key={action} disabled={busy} onSelect={() => onAction(action)}><ActionIcon strokeWidth={1.65} aria-hidden />{t(key)}</DropdownMenuItem>;
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

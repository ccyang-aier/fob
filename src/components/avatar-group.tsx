'use client';

import type { CSSProperties } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { UserAvatar } from './user-avatar';
import { messages } from './avatar-group.messages';
import styles from './avatar-group.module.css';

export interface AvatarGroupMember {
  id: string;
  name: string;
  image?: string | null;
}

export interface AvatarGroupProps {
  members: readonly AvatarGroupMember[];
  maxVisible?: number;
  size?: number;
  className?: string;
}

export function AvatarGroup({ members, maxVisible = 3, size = 24, className }: AvatarGroupProps) {
  const { t, locale } = useTranslation(messages);
  if (!members.length) return null;

  const visible = members.slice(0, maxVisible);
  const remaining = members.slice(maxVisible);
  const remainingLabel = t('remaining', {
    count: remaining.length,
    names: new Intl.ListFormat(locale).format(remaining.map(member => member.name)),
  });

  return <span className={cn(styles.group, className)} role="group" aria-label={t('members', { count: members.length })} style={{ '--avatar-group-size': `${size}px` } as CSSProperties}>
    {visible.map(member => <Tooltip key={member.id}>
      <TooltipTrigger asChild><span className={styles.item} role="img" aria-label={member.name}><UserAvatar name={member.name} image={member.image} className={styles.avatar} /></span></TooltipTrigger>
      <TooltipContent className={styles.tooltip}>{member.name}</TooltipContent>
    </Tooltip>)}
    {remaining.length > 0 && <Tooltip>
      <TooltipTrigger asChild><span className={cn(styles.item, styles.remaining)} role="img" aria-label={remainingLabel}>+{remaining.length}</span></TooltipTrigger>
      <TooltipContent className={styles.tooltip}>{remainingLabel}</TooltipContent>
    </Tooltip>}
  </span>;
}

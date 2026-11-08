'use client';

import { GenerateStar } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { assistantMessages } from './assistant.messages';
import styles from './assistant.module.css';

export { AssistantPanel } from './assistant-conversation';

export function AssistantEntry({ open, onClick }: { open: boolean; onClick(): void }) {
  const { t } = useTranslation(assistantMessages);
  return <Tooltip><TooltipTrigger asChild><button type="button" data-surface="plain" data-variant="hover" className={`fob-action ${styles.entry}`} aria-label={t('open')} aria-expanded={open} onClick={onClick}><GenerateStar size={16} aria-hidden /><span>AI</span></button></TooltipTrigger><TooltipContent>{t('open')}</TooltipContent></Tooltip>;
}

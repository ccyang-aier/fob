'use client';

import { useTranslation } from '@/lib/i18n';
import { knowledgeMessages } from './document-action-menu-content.messages';
import {
  ArrowSquareOut,
  FileDashed,
  PencilSimple,
  ShareNetwork,
  Star,
  Trash,
} from '@phosphor-icons/react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useI18n } from './use-i18n';
import styles from './sidebar-interactions.module.css';

export type DocumentAction =
  'toggle-draft' | 'rename' | 'toggle-star' | 'trash' | 'share' | 'open-tab';

export function DocumentActionMenuContent({
  documentId,
  starred,
  onAction,
}: {
  documentId: string;
  starred: boolean;
  onAction: (id: string, action: DocumentAction) => void;
}) {
  const { t: knowledgeT } = useTranslation(knowledgeMessages);

  const { t } = useI18n();
  return (
    <DropdownMenuContent align="end" className={styles.documentMenu}>
      <DropdownMenuItem onSelect={() => onAction(documentId, 'rename')}>
        <PencilSimple weight="bold" />
        {t('sidebar.rename')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction(documentId, 'share')}>
        <ShareNetwork weight="bold" />
        {knowledgeT('share')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction(documentId, 'open-tab')}>
        <ArrowSquareOut weight="bold" />
        {knowledgeT('openInNewTab')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => onAction(documentId, 'toggle-star')}>
        <Star weight={starred ? 'fill' : 'bold'} />
        {t(starred ? 'sidebar.removeFavorite' : 'sidebar.addFavorite')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => onAction(documentId, 'toggle-draft')}>
        <FileDashed weight="bold" />
        {knowledgeT('toggleDraftFlag')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive" onSelect={() => onAction(documentId, 'trash')}>
        <Trash weight="bold" />
        {t('sidebar.moveToTrash')}
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

'use client';

import type { PermissionLevel } from '@fob/shared/knowledge/contracts';
import { WarningCircle } from '@/components/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { readonlyMessageCopy, type ReadonlyReason } from '../editor-state';
import styles from './document-access-indicator.module.css';

/** The access explanation belongs to document metadata, outside its body. */
export function DocumentAccessIndicator({ reason, level }: { reason: ReadonlyReason; level: PermissionLevel }) {
  const message = readonlyMessageCopy(reason, level);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-document-access
          data-surface="plain"
          data-variant="hover"
          data-tone={reason === 'auth-failed' ? 'error' : 'warning'}
          aria-label={message}
          className={`fob-action ${styles.indicator}`}
        >
          <WarningCircle size={16} aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" collisionPadding={16} className="max-w-[min(360px,calc(100vw-32px))] text-left leading-relaxed">
        {message}
      </TooltipContent>
    </Tooltip>
  );
}

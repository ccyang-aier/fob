'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/app-alert.messages';

import type { ReactNode } from 'react';
import { CheckCircle, Info, WarningCircle, X, XCircle } from '@/components/icons';

import { cn } from '@/lib/utils';
import styles from './app-alert.module.css';

export type AppAlertTone = 'success' | 'info' | 'warning' | 'error';

export interface AppAlertProps {
  tone: AppAlertTone;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  markerColor?: string;
  onClose?: () => void;
  className?: string;
}

const icons = { success: CheckCircle, info: Info, warning: WarningCircle, error: XCircle };

/** The shared notification surface, also used for persistent contextual messages. */
export function AppAlert({
  tone,
  title,
  description,
  action,
  markerColor,
  onClose,
  className,
}: AppAlertProps) {
  const uiText = useTranslation(messages).t;
  const Icon = icons[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
      data-app-alert=""
      data-tone={tone}
      className={cn(styles.alert, className)}
    >
      {markerColor ? (
        <span className={styles.marker} style={{ backgroundColor: markerColor }} aria-hidden />
      ) : (
        <Icon className={styles.icon} aria-hidden />
      )}
      <div className={styles.message}>
        <span>{title}</span>
        {description ? <div className={styles.description}>{description}</div> : null}
        {action ? <div className={styles.action}>{action}</div> : null}
      </div>
      {onClose ? (
        <button
          type="button"
          onClick={onClose}
          aria-label={uiText('关闭通知')}
          className={cn('fob-action', styles.close)}
        >
          <X className="size-3" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

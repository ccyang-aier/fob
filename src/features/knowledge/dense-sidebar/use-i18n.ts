'use client';

import { useTranslation } from '@/lib/i18n';
import { sidebarMessages } from './messages';

export function useI18n() {
  const { locale, t } = useTranslation(sidebarMessages);
  return { locale: locale === 'zh-CN' ? ('zh' as const) : ('en' as const), t };
}

'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/react';
import { metadataMessages } from './i18n/metadata.messages';

const pageTitles: Record<string, keyof typeof metadataMessages> = {
  '/auth': 'signIn',
  '/auth/verify': 'verify',
  '/auth/callback': 'callback',
};

/** Keep localized metadata after Next restores route metadata during hydration. */
export function ApplicationMetadata() {
  const pathname = usePathname();
  const { t } = useTranslation(metadataMessages);
  const title = t(pageTitles[pathname] ?? 'workbench');
  const description = t('description');
  useEffect(() => {
    const apply = () => {
      if (document.title !== title) document.title = title;
      const meta = document.querySelector('meta[name="description"]');
      if (meta?.getAttribute('content') !== description) meta?.setAttribute('content', description);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(document.head, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['content'],
    });
    return () => observer.disconnect();
  }, [title, description]);
  return null;
}

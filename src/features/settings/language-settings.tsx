'use client';

import { Check, Translate } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAppAlert } from '@/components/app-alert-provider';
import { setLocale, type Locale } from '@/lib/i18n/locale';
import { translate } from '@/lib/i18n/messages';
import { useTranslation } from '@/lib/i18n/react';
import { SettingsSection } from './appearance/section-card';
import { languageMessages } from './i18n/language.messages';

const options = [
  { value: 'zh-CN', name: '简体中文', detail: 'Chinese' },
  { value: 'en-US', name: 'English', detail: '英语' },
] as const;

export function LanguageSettings() {
  const { locale, t } = useTranslation(languageMessages);
  const { notify } = useAppAlert();
  function select(next: Locale) {
    if (!setLocale(next).persisted)
      notify('warning', translate(languageMessages, 'temporary', undefined, next));
  }
  return (
    <SettingsSection title={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Translate size={16} className="text-[var(--muted-strong)]" aria-hidden />
          <div>
            <h3 className="text-[12px] font-medium">{t('label')}</h3>
            <p className="mt-1 text-[11.5px] text-[var(--muted)]">{t('description')}</p>
          </div>
        </div>
        <div role="group" aria-label={t('label')} className="flex gap-2">
          {options.map((option) => (
            <Button
              key={option.value}
              variant="outline"
              onClick={() => select(option.value)}
              aria-pressed={locale === option.value}
              lang={option.value}
              className="h-auto min-w-[116px] justify-between gap-3 px-3 py-2.5 text-left aria-pressed:border-[var(--accent)] aria-pressed:bg-[var(--accent-soft)]"
            >
              <span>
                <span className="block text-[12px] font-medium">{option.name}</span>
                <span className="mt-0.5 block text-[10px] text-[var(--muted)]">
                  {option.detail}
                </span>
              </span>
              <Check
                size={14}
                className={locale === option.value ? 'text-[var(--accent)]' : 'invisible'}
                aria-hidden
              />
            </Button>
          ))}
        </div>
      </div>
    </SettingsSection>
  );
}

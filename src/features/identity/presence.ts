import { createTranslator } from '@/lib/i18n/messages';
import { getLocale, type Locale } from '@/lib/i18n/locale';
import { messages } from './i18n/presence.messages';

export const presenceOptions = [
  { value: 'online', label: '在线', description: '可随时联系', color: '#35a879' },
  { value: 'away', label: '离开', description: '暂时不在', color: '#d7a345' },
  { value: 'do-not-disturb', label: '勿扰', description: '专注中，请稍后联系', color: '#d46a73' },
  { value: 'busy', label: '忙碌', description: '正在处理工作', color: '#c67c48' },
] as const;

export type PresencePreference = (typeof presenceOptions)[number]['value'];
export type PresenceStatus = PresencePreference | 'offline';
export const presenceIdleMs = 5 * 60 * 1_000;

export function readPresencePreference(value: string | null): PresencePreference {
  return presenceOptions.find((option) => option.value === value)?.value ?? 'online';
}

export function resolvePresence(
  preference: PresencePreference,
  connected: boolean,
  idle: boolean,
): PresenceStatus {
  if (!connected) return 'offline';
  return preference === 'online' && idle ? 'away' : preference;
}

export function getPresenceOptions(locale: Locale = getLocale()) {
  const uiText = createTranslator(messages, locale);
  return presenceOptions.map((option) => ({
    ...option,
    label: uiText(option.label),
    description: uiText(option.description),
  }));
}

export function presenceDisplay(status: PresenceStatus, locale: Locale = getLocale()) {
  const uiText = createTranslator(messages, locale);
  return (
    getPresenceOptions(locale).find((option) => option.value === status) ?? {
      value: 'offline',
      label: uiText('离线'),
      description: uiText('网络连接已断开'),
      color: '#969da5',
    }
  );
}

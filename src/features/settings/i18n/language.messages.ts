import { defineMessages } from '@/lib/i18n/messages';

export const languageMessages = defineMessages({
  title: ['语言', 'Language'],
  label: ['界面语言', 'Interface language'],
  description: ['切换后立即生效。', 'Changes apply immediately.'],
  temporary: [
    '语言已切换，但浏览器未允许保存偏好。',
    'Language changed, but the browser could not save your preference.',
  ],
});

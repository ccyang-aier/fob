import { defineMessages } from '@/lib/i18n';

export const knowledgeMessages = defineMessages({
  unableToLoad: ['加载失败', 'Unable to load'],
  retry: ['重试', 'Retry'],
  accessDenied: ['没有访问权限', 'Access denied'],
  openingSignIn: ['正在前往登录', 'Opening sign-in'],
  yourSessionNeedsVerificationYouWillReturnHere: [
    '当前会话需要重新验证，登录后会回到这里。',
    'Your session needs verification. You will return here after signing in.',
  ],
});

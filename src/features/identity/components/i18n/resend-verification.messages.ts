import { defineMessages } from '@/lib/i18n/messages';

export const messages = defineMessages({
  请输入邮箱地址: ['请输入邮箱地址', 'Enter your email address'],
  发送请求已受理: ['发送请求已受理', 'Request received'],
  '如该邮箱已注册且尚未验证,将收到新的验证邮件;未收到请稍后再试或检查垃圾箱。': [
    '如该邮箱已注册且尚未验证,将收到新的验证邮件;未收到请稍后再试或检查垃圾箱。',
    'If this email is registered and unverified, a new verification email will be sent. Check your spam folder or try again later.',
  ],
  邮箱地址: ['邮箱地址', 'Email address'],
  '重新发送({0}s)': ['重新发送({0}s)', 'Resend ({0}s)'],
  重新发送验证邮件: ['重新发送验证邮件', 'Resend verification email'],
});

import { defineMessages } from '@/lib/i18n/messages';

export const messages = defineMessages({
  验证链接已过期: ['验证链接已过期', 'Verification link expired'],
  '验证链接在 1 小时后失效。可以重新发送验证邮件,再打开新链接完成验证。': [
    '验证链接在 1 小时后失效。可以重新发送验证邮件,再打开新链接完成验证。',
    'Verification links expire after 1 hour. Resend the email and open the new link.',
  ],
  验证链接无效: ['验证链接无效', 'Invalid verification link'],
  '链接可能已被使用过或不是最新的。若尚未验证,可重新发送验证邮件。': [
    '链接可能已被使用过或不是最新的。若尚未验证,可重新发送验证邮件。',
    'This link may have been used or replaced. Resend the verification email if needed.',
  ],
  未找到对应账号: ['未找到对应账号', 'Account not found'],
  '这个链接对应的账号不存在,可能已被删除。请重新注册或联系管理员。': [
    '这个链接对应的账号不存在,可能已被删除。请重新注册或联系管理员。',
    'The account for this link no longer exists. Register again or contact your administrator.',
  ],
  账号状态校验未通过: ['账号状态校验未通过', 'Account state verification failed'],
  '链接与当前账号不匹配,无法完成验证;请重新发送或联系管理员。': [
    '链接与当前账号不匹配,无法完成验证;请重新发送或联系管理员。',
    'The link does not match the account. Resend the email or contact your administrator.',
  ],
});

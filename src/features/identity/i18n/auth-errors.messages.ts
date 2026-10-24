import { defineMessages } from '@/lib/i18n/messages';

export const messages = defineMessages({
  登录会话未能保存: ['登录会话未能保存', 'Sign-in session could not be saved'],
  '浏览器没有保存会话，请检查 Cookie 设置后重试。': [
    '浏览器没有保存会话，请检查 Cookie 设置后重试。',
    'The browser did not save the session. Check your cookie settings and try again.',
  ],
  邮箱或密码不正确: ['邮箱或密码不正确', 'Email or password is incorrect'],
  '请检查后重试;若刚注册,请先完成邮箱验证再登录。': [
    '请检查后重试;若刚注册,请先完成邮箱验证再登录。',
    'Check your details and try again. If you just registered, verify your email before signing in.',
  ],
  邮箱尚未验证: ['邮箱尚未验证', 'Email is not verified'],
  '该邮箱已注册但尚未完成验证,请查收验证邮件后再登录。': [
    '该邮箱已注册但尚未完成验证,请查收验证邮件后再登录。',
    'This email is registered but not verified. Open the verification email before signing in.',
  ],
  验证邮件暂时未能发送: ['验证邮件暂时未能发送', 'Verification email could not be sent'],
  '邮件通道暂时不可用,稍后可以在此重新发送。': [
    '邮件通道暂时不可用,稍后可以在此重新发送。',
    'Email delivery is temporarily unavailable. You can resend the message here later.',
  ],
  认证服务暂时不可用: ['认证服务暂时不可用', 'Authentication is temporarily unavailable'],
  '请稍后重试;若持续出现,请联系管理员。': [
    '请稍后重试;若持续出现,请联系管理员。',
    'Try again later. If this continues, contact your administrator.',
  ],
  操作过于频繁: ['操作过于频繁', 'Too many attempts'],
  '为保障账号安全,请等待约一分钟后再试。': [
    '为保障账号安全,请等待约一分钟后再试。',
    'To protect your account, wait about a minute before trying again.',
  ],
  无法连接认证服务: ['无法连接认证服务', 'Unable to reach authentication'],
  '请检查网络连接后重试。': [
    '请检查网络连接后重试。',
    'Check your network connection and try again.',
  ],
  认证服务地址未配置: ['认证服务地址未配置', 'Authentication endpoint is not configured'],
  '当前部署缺少认证服务配置,请联系管理员。': [
    '当前部署缺少认证服务配置,请联系管理员。',
    'Authentication is not configured for this deployment. Contact your administrator.',
  ],
  请求未能完成: ['请求未能完成', 'Request could not be completed'],
  '请检查输入后重试;若持续出现,请联系管理员。': [
    '请检查输入后重试;若持续出现,请联系管理员。',
    'Check your input and try again. If this continues, contact your administrator.',
  ],
});

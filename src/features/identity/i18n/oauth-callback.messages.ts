import { defineMessages } from '@/lib/i18n/messages';

export const messages = defineMessages({
  已取消企业登录: ['已取消企业登录', 'Enterprise sign-in canceled'],
  '你在身份提供方拒绝了授权,可随时重新发起登录。': [
    '你在身份提供方拒绝了授权,可随时重新发起登录。',
    'Authorization was declined at the identity provider. You can try signing in again.',
  ],
  身份提供方返回错误: ['身份提供方返回错误', 'Identity provider returned an error'],
  '企业登录服务暂时异常,请稍后重试;若持续失败请联系管理员。': [
    '企业登录服务暂时异常,请稍后重试;若持续失败请联系管理员。',
    'Enterprise sign-in is temporarily unavailable. Try later, or contact your administrator if it continues.',
  ],
  登录流程已失效: ['登录流程已失效', 'Sign-in flow expired'],
  '本次登录缺少状态凭据,可能已超时,请重新发起登录。': [
    '本次登录缺少状态凭据,可能已超时,请重新发起登录。',
    'This sign-in is missing its state token and may have expired. Start sign-in again.',
  ],
  登录状态校验未通过: ['登录状态校验未通过', 'Sign-in state verification failed'],
  '本次登录的状态凭据无效或已过期(10 分钟内有效),请重新发起。': [
    '本次登录的状态凭据无效或已过期(10 分钟内有效),请重新发起。',
    'The sign-in state token is invalid or expired (valid for 10 minutes). Start again.',
  ],
  登录状态无效: ['登录状态无效', 'Invalid sign-in state'],
  '本次登录的状态凭据无法解析,请重新发起登录。': [
    '本次登录的状态凭据无法解析,请重新发起登录。',
    'The state token could not be read. Start sign-in again.',
  ],
  '本次登录的状态凭据不匹配,请重新发起登录。': [
    '本次登录的状态凭据不匹配,请重新发起登录。',
    'The sign-in state token does not match. Start again.',
  ],
  回调请求无效: ['回调请求无效', 'Invalid callback request'],
  '身份提供方返回的数据无法识别,请重新发起登录。': [
    '身份提供方返回的数据无法识别,请重新发起登录。',
    'The identity provider response could not be read. Start sign-in again.',
  ],
  未收到授权结果: ['未收到授权结果', 'No authorization result received'],
  '身份提供方没有返回授权码,请重新发起登录。': [
    '身份提供方没有返回授权码,请重新发起登录。',
    'The identity provider did not return an authorization code. Start sign-in again.',
  ],
  登录入口不存在: ['登录入口不存在', 'Sign-in provider not found'],
  '该企业登录入口已下线或配置变更,请返回重新选择登录方式。': [
    '该企业登录入口已下线或配置变更,请返回重新选择登录方式。',
    'This enterprise sign-in provider is no longer available or its configuration changed. Choose a sign-in method again.',
  ],
  身份提供方校验未通过: ['身份提供方校验未通过', 'Identity provider verification failed'],
  '回调的签发方与配置不一致,登录已中止;请联系管理员核对配置。': [
    '回调的签发方与配置不一致,登录已中止;请联系管理员核对配置。',
    'The callback issuer does not match the configuration. Sign-in was stopped. Ask your administrator to check it.',
  ],
  安全校验缺失: ['安全校验缺失', 'Security verification missing'],
  '本次登录缺少必需的 nonce 绑定,请重新发起;若持续出现请联系管理员。': [
    '本次登录缺少必需的 nonce 绑定,请重新发起;若持续出现请联系管理员。',
    'The required nonce binding is missing. Start again, or contact your administrator if it continues.',
  ],
  授权码已失效: ['授权码已失效', 'Authorization code expired'],
  '授权码一次性使用且有效期很短,请重新发起登录。': [
    '授权码一次性使用且有效期很短,请重新发起登录。',
    'Authorization codes are short-lived and single-use. Start sign-in again.',
  ],
  无法读取账号信息: ['无法读取账号信息', 'Unable to read account details'],
  '身份提供方未返回可用的账号资料,请重试;若持续出现请联系管理员。': [
    '身份提供方未返回可用的账号资料,请重试;若持续出现请联系管理员。',
    'The identity provider did not return usable account details. Try again, or contact your administrator.',
  ],
  登录流程中断: ['登录流程中断', 'Sign-in interrupted'],
  '登录会话缺少回跳目标,请重新发起登录。': [
    '登录会话缺少回跳目标,请重新发起登录。',
    'The sign-in session is missing its return destination. Start sign-in again.',
  ],
  账号关联失败: ['账号关联失败', 'Account linking failed'],
  '本次关联未能完成,请重新发起;若持续出现请联系管理员。': [
    '本次关联未能完成,请重新发起;若持续出现请联系管理员。',
    'Account linking could not be completed. Start again, or contact your administrator.',
  ],
  邮箱不一致: ['邮箱不一致', 'Email addresses do not match'],
  '该外部账号的邮箱与当前账号不匹配,关联已拒绝。': [
    '该外部账号的邮箱与当前账号不匹配,关联已拒绝。',
    'The external account email does not match your account. Linking was refused.',
  ],
  账号已被其他用户占用: ['账号已被其他用户占用', 'Account is already linked'],
  '此外部账号已关联到另一位用户,请改用对应的登录方式。': [
    '此外部账号已关联到另一位用户,请改用对应的登录方式。',
    'This external account is linked to another user. Use the sign-in method for that account.',
  ],
  未获取到邮箱: ['未获取到邮箱', 'Email address missing'],
  '身份提供方没有返回邮箱地址,无法完成登录;请联系管理员检查配置。': [
    '身份提供方没有返回邮箱地址,无法完成登录;请联系管理员检查配置。',
    'The identity provider did not return an email address. Sign-in cannot complete. Ask your administrator to check the configuration.',
  ],
  邮箱未在提供方验证: ['邮箱未在提供方验证', 'Email is not verified by the provider'],
  '请先在身份提供方完成邮箱验证,再回来登录。': [
    '请先在身份提供方完成邮箱验证,再回来登录。',
    'Verify your email with the identity provider before signing in here.',
  ],
  身份不被接受: ['身份不被接受', 'Identity is not allowed'],
  '该账号的邮箱未验证或不在允许的域名范围内,请联系管理员。': [
    '该账号的邮箱未验证或不在允许的域名范围内,请联系管理员。',
    'This email is unverified or outside the allowed domains. Contact your administrator.',
  ],
  会话已变化: ['会话已变化', 'Session changed'],
  '发起登录时的会话与当前不一致,请重新发起登录。': [
    '发起登录时的会话与当前不一致,请重新发起登录。',
    'Your session changed since sign-in started. Start sign-in again.',
  ],
  登录服务内部错误: ['登录服务内部错误', 'Sign-in service error'],
  '处理登录时发生服务端错误,请稍后重试;若持续出现请联系管理员。': [
    '处理登录时发生服务端错误,请稍后重试;若持续出现请联系管理员。',
    'A server error occurred during sign-in. Try later, or contact your administrator.',
  ],
  登录未能完成: ['登录未能完成', 'Sign-in could not be completed'],
  '发生未预期的错误,请重新发起登录;若持续出现请联系管理员。': [
    '发生未预期的错误,请重新发起登录;若持续出现请联系管理员。',
    'An unexpected error occurred. Start sign-in again, or contact your administrator.',
  ],
});

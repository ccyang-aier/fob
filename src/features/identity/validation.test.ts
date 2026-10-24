import { describe, expect, test } from 'bun:test';
import {
  hasAuthFieldErrors,
  validateAuthEmail,
  validateAuthName,
  validateAuthPassword,
  validateSignInForm,
  validateSignUpForm,
} from './validation';

describe('validateAuthEmail', () => {
  test('accepts ordinary addresses and trims surrounding space', () => {
    expect(validateAuthEmail('user@example.com')).toBeNull();
    expect(validateAuthEmail('  user.name+tag@sub.example.co  ')).toBeNull();
  });

  test('rejects empty, malformed, oversized and multi-part input', () => {
    expect(validateAuthEmail('')).toBe('请输入邮箱地址');
    expect(validateAuthEmail('   ')).toBe('请输入邮箱地址');
    expect(validateAuthEmail('plainaddress')).toBe('邮箱地址格式不正确');
    expect(validateAuthEmail('a@b')).toBe('邮箱地址格式不正确');
    expect(validateAuthEmail('a b@example.com')).toBe('邮箱地址格式不正确');
    expect(validateAuthEmail('missing@')).toBe('邮箱地址格式不正确');
    expect(validateAuthEmail('@example.com')).toBe('邮箱地址格式不正确');
    expect(validateAuthEmail(`${'a'.repeat(310)}@example.com`)).toBe('邮箱地址过长');
  });
});

describe('validateAuthPassword — 12–128 backend contract (A01)', () => {
  test('boundaries', () => {
    expect(validateAuthPassword('')).toBe('请输入密码');
    expect(validateAuthPassword('a'.repeat(11))).toBe('密码至少 12 位');
    expect(validateAuthPassword('a'.repeat(12))).toBeNull();
    expect(validateAuthPassword('a'.repeat(128))).toBeNull();
    expect(validateAuthPassword('a'.repeat(129))).toBe('密码不能超过 128 位');
  });

  test('unicode characters count per code unit like the server-side length check', () => {
    expect(validateAuthPassword('密码密码密码密码密码密码')).toBeNull();
  });
});

describe('validateAuthName — 1–120 after trim (A01 server hook)', () => {
  test('boundaries', () => {
    expect(validateAuthName('')).toBe('请输入名称');
    expect(validateAuthName('   ')).toBe('请输入名称');
    expect(validateAuthName('  阿明  ')).toBeNull();
    expect(validateAuthName('a'.repeat(120))).toBeNull();
    expect(validateAuthName('a'.repeat(121))).toBe('名称不能超过 120 个字符');
  });
});

describe('form matrices', () => {
  test('sign-in reports each invalid field and passes a valid form', () => {
    expect(validateSignInForm({ email: '', password: '' })).toEqual({
      email: '请输入邮箱地址',
      password: '请输入密码',
    });
    expect(validateSignInForm({ email: 'bad', password: 'short' })).toEqual({
      email: '邮箱地址格式不正确',
      password: '密码至少 12 位',
    });
    expect(validateSignInForm({ email: 'user@example.com', password: 'a-strong-password' })).toEqual({});
  });

  test('sign-up adds the name field', () => {
    expect(validateSignUpForm({ name: '', email: 'user@example.com', password: 'a-strong-password' })).toEqual({
      name: '请输入名称',
    });
    expect(validateSignUpForm({ name: '阿明', email: 'user@example.com', password: 'a-strong-password' })).toEqual({});
  });

  test('hasAuthFieldErrors', () => {
    expect(hasAuthFieldErrors({})).toBe(false);
    expect(hasAuthFieldErrors({ email: undefined, password: '太短' })).toBe(true);
  });
});

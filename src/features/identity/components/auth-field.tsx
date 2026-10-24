'use client';

import { useTranslation } from '@/lib/i18n/react';
import { messages } from './i18n/auth-field.messages';

/**
 * Shared authentication input with a quiet paper fill and border-only focus.
 * Password visibility and error descriptions remain accessible to keyboards
 * and screen readers.
 */

import { useId, useState } from 'react';
import { Eye, EyeSlash } from '@phosphor-icons/react';
import styles from './auth-form.module.css';

export function AuthTextField({
  label,
  value,
  onChange,
  type = 'text',
  autoComplete,
  inputMode,
  placeholder,
  error,
  hint,
  disabled,
  onInputBlur,
  autoFocus,
  maxLength,
  'data-testid': testId,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password';
  autoComplete?: string;
  inputMode?: 'text' | 'email';
  placeholder?: string;
  error?: string | null;
  hint?: string | null;
  disabled?: boolean;
  onInputBlur?: () => void;
  autoFocus?: boolean;
  maxLength?: number;
  'data-testid'?: string;
}) {
  const uiText = useTranslation(messages).t;
  const id = useId();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={styles.inputShell} data-invalid={Boolean(error)}>
        <input
          id={id}
          data-testid={testId}
          type={type === 'password' && passwordVisible ? 'text' : type}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onInputBlur}
          autoComplete={autoComplete}
          inputMode={inputMode}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          maxLength={maxLength}
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={styles.input}
        />
        {type === 'password' ? (
          <button
            type="button"
            className={`fob-action ${styles.passwordToggle}`}
            disabled={disabled}
            aria-label={passwordVisible ? uiText('隐藏密码') : uiText('显示密码')}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible((visible) => !visible)}
          >
            {passwordVisible ? <EyeSlash size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
          </button>
        ) : null}
      </div>
      {error ? (
        <p id={errorId} role="alert" className={styles.error}>
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

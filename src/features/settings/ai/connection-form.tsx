'use client';

import { useId } from 'react';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { aiSettingsMessages } from './messages';
import { needsPersonalKey, providerEndpoint, type AIProvider } from './connection-state';
import { useAIConnection, type AIConnectionOptions } from './use-ai-connection';
import styles from './ai-settings.module.css';

export function AIConnectionForm({ compact = false, onCancel, ...options }: AIConnectionOptions & { compact?: boolean; onCancel?(): void }) {
  const { t, locale } = useTranslation(aiSettingsMessages);
  const state = useAIConnection(options);
  const { draft, saved, busy, dirty } = state;
  const id = useId(), needsKey = needsPersonalKey(draft.provider);
  const endpoint = providerEndpoint(draft.provider, saved);
  const count = new Intl.NumberFormat(locale);
  return <form className={cn(styles.form, compact && styles.compact)} onSubmit={event => { event.preventDefault(); void state.save(); }}>
    {compact && <p className={styles.hint}>{t('personalScope')}</p>}
    <section className={styles.section} aria-labelledby={`${id}-service`}>
      <header className={styles.sectionHeader}>
        <h3 id={`${id}-service`}>{t('service')}</h3>
        <span className={styles.status} data-ready={!dirty && saved.ready} role="status"><span className={styles.statusDot} aria-hidden />{t(dirty ? 'unsaved' : saved.ready ? 'configured' : 'notConfigured')}</span>
      </header>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('provider')}</span>
        <select className={styles.control} value={draft.provider} disabled={Boolean(busy)} onChange={event => state.selectProvider(event.target.value as AIProvider)}>
          <option value="default">{t('platform')}</option>
          <option value="zhipu-coding">{t('coding')}</option>
          <option value="zhipu-general">{t('general')}</option>
          {saved.ollamaAvailable && <option value="ollama">{t('ollama')}</option>}
        </select>
      </label>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('model')}</span>
        <input className={styles.control} name="fob-model-name" value={draft.model} readOnly={draft.provider === 'default'} required={draft.provider !== 'default'} maxLength={200} disabled={Boolean(busy)} placeholder={draft.provider === 'default' ? t('noEndpoint') : t('modelPlaceholder')} onChange={event => state.change({ model: event.target.value })} />
      </label>
      {needsKey && <label className={styles.field}>
        <span className={styles.fieldLabel}>{t('apiKey')}</span>
        <input className={styles.control} type="password" autoComplete="new-password" name="fob-model-credential" spellCheck={false} value={draft.apiKey} maxLength={8192} placeholder={saved.hasCredential && draft.provider === saved.provider ? t('savedKey') : t('keyPlaceholder')} required={!saved.hasCredential || draft.provider !== saved.provider} disabled={Boolean(busy)} aria-describedby={`${id}-key-help`} onChange={event => state.change({ apiKey: event.target.value })} />
        <span className={styles.hint} id={`${id}-key-help`}>{t('keyHelp')}</span>
      </label>}
      {draft.provider === 'default' && !saved.platformModel && <p className={styles.hint}>{t('missingPlatform')}</p>}
      {draft.provider === 'default' && saved.hasCredential && <p className={styles.hint}>{t('resetHelp')}</p>}
      {(endpoint || draft.provider === saved.provider) && <dl className={styles.endpoint}><dt>{t('endpoint')}</dt><dd>{endpoint ?? t('noEndpoint')}</dd></dl>}
    </section>
    <section className={cn(styles.section, styles.usage)} aria-labelledby={`${id}-usage`}>
      <header className={styles.sectionHeader}><h3 id={`${id}-usage`}>{t('usage')}</h3><span className={styles.hint}>{t('usageScope')}</span></header>
      <dl className={styles.metrics}>{(['calls', 'input', 'output'] as const).map((label, index) => <div className={styles.metric} key={label}><dt>{t(label)}</dt><dd>{count.format([saved.calls, saved.inputTokens, saved.outputTokens][index])}</dd></div>)}</dl>
    </section>
    {(state.error || state.checked) && <div className={styles.feedback}>
      {state.error && <AppAlert tone="error" title={state.error} />}
      {state.checked && <p className={styles.checked} role="status">{t('checked', { model: state.checked })}</p>}
    </div>}
    <footer className={styles.actions}>
      <Button type="button" variant="outline" size="sm" loading={busy === 'check'} disabled={busy === 'save' || !state.canCheck} onClick={() => void state.save(true)}>{t(dirty ? 'saveCheck' : 'check')}</Button>
      <span className={styles.spacer} />
      {onCancel && <Button type="button" variant="outline" size="sm" onClick={onCancel}>{t('cancel')}</Button>}
      <Button type="submit" size="sm" loading={busy === 'save'} disabled={busy === 'check' || !state.valid || !dirty}>{t('save')}</Button>
    </footer>
  </form>;
}

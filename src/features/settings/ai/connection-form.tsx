'use client';

import { useState } from 'react';
import { Plus } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { AIModelPicker } from '@/features/knowledge/ai/model-picker';
import { aiSettingsMessages } from './messages';
import { protocolLabels } from './connection-state';
import { ConnectionEditor } from './connection-editor';
import { useAIConnections, type AIConnectionOptions } from './use-ai-connections';
import styles from './ai-settings.module.css';

export function AIConnectionForm({ compact = false, onCancel, ...options }: AIConnectionOptions & { compact?: boolean; onCancel?(): void }) {
  const { t, locale } = useTranslation(aiSettingsMessages);
  const controller = useAIConnections(options), { settings, busy } = controller;
  const [selectedId, setSelectedId] = useState('platform'), [editorSession, setEditorSession] = useState(0);
  const connections = settings.connections ?? [], selections = settings.selections ?? { fast: null, smart: null };
  const platform = settings.platformModels ?? { fast: settings.platformModel, smart: settings.platformModel };
  const selected = connections.find(connection => connection.id === selectedId);
  const platformModelCount = new Set([platform.fast, platform.smart].filter(Boolean)).size;
  function select(id: string) { setSelectedId(id); setEditorSession(current => current + 1); }
  const count = new Intl.NumberFormat(locale);
  return <div data-ai-connections className={cn(styles.manager, compact && styles.compact)}>
    {compact && <p className={styles.hint}>{t('personalScope')}</p>}
    <section className={styles.defaults} aria-label={t('defaults')}>
      <h3>{t('defaults')}</h3>
      <div className={styles.defaultChoices}>{(['fast', 'smart'] as const).map(tier => <div className={styles.defaultField} key={tier}>
        <span>{t(tier)}</span><AIModelPicker label={`${t('defaults')} · ${t(tier)}`} defaultLabel={platform[tier] ? `${t('platform')} · ${platform[tier]}` : `${t('platform')} · ${t('notConfigured')}`} connections={connections} value={selections[tier]} disabled={Boolean(busy)} className={styles.defaultPicker} onChange={value => void controller.saveSelections({ ...selections, [tier]: value })} />
      </div>)}</div>
    </section>
    <section className={styles.connectionSection} aria-label={t('connections')}>
      <header className={styles.sectionHeader}><h3>{t('connections')}</h3><Button type="button" variant="outline" size="sm" disabled={Boolean(busy) || connections.length >= 24} onClick={() => select('new')}><Plus size={14} aria-hidden />{t('addConnection')}</Button></header>
      <div className={styles.workspace}>
        <nav className={styles.connectionList} aria-label={t('connections')}>
          <button type="button" data-surface="plain" className={`fob-action ${styles.connectionRow}`} aria-pressed={selectedId === 'platform'} disabled={Boolean(busy)} onClick={() => select('platform')}><span className={styles.connectionTitle}>{t('platform')}<small>{platformModelCount}</small></span><span className={styles.connectionMeta}>{t('readOnlySource')}</span></button>
          {connections.map(connection => <button type="button" key={connection.id} data-surface="plain" className={`fob-action ${styles.connectionRow}`} aria-pressed={selectedId === connection.id} disabled={Boolean(busy)} onClick={() => select(connection.id)}><span className={styles.connectionTitle}><span>{connection.name}</span><small>{connection.models.length}</small></span><span className={styles.connectionMeta}>{protocolLabels[connection.protocol]}</span></button>)}
          {selectedId === 'new' && <button type="button" data-surface="plain" className={`fob-action ${styles.connectionRow}`} aria-pressed disabled={Boolean(busy)} onClick={() => {}}><span className={styles.connectionTitle}>{t('newConnection')}</span><span className={styles.connectionMeta}>{t('unsaved')}</span></button>}
        </nav>
        {selectedId === 'new' || selected ? <ConnectionEditor key={editorSession} connection={selected} controller={controller} onCreated={setSelectedId} onRemoved={() => select('platform')} /> : <section className={styles.editor} aria-label={t('platform')}>
          <header className={styles.sectionHeader}><h3>{t('platform')}</h3><span className={styles.sourceTag}>{t('readOnlySource')}</span></header>
          <dl className={styles.platformModels}>{(['fast', 'smart'] as const).map(tier => <div key={tier}><dt>{t(tier)}</dt><dd>{platform[tier] ?? t('notConfigured')}</dd></div>)}</dl>
          <p className={styles.hint}>{t('platformDescription')}</p>
        </section>}
      </div>
    </section>
    {controller.error && <AppAlert tone="error" title={controller.error} />}
    <section className={styles.usage} aria-label={t('usage')}>
      <header className={styles.sectionHeader}><h3>{t('usage')}</h3><span className={styles.hint}>{t('usageScope')}</span></header>
      <dl className={styles.metrics}>{(['calls', 'input', 'output'] as const).map((label, index) => <div className={styles.metric} key={label}><dt>{t(label)}</dt><dd>{count.format([settings.calls, settings.inputTokens, settings.outputTokens][index])}</dd></div>)}</dl>
    </section>
    {compact && <footer className={styles.actions}><span className={styles.spacer} /><Button type="button" variant="outline" size="sm" onClick={onCancel ?? options.onDone}>{t('done')}</Button></footer>}
  </div>;
}

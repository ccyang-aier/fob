'use client';

import { useEffect, useRef, useState } from 'react';
import type { AssistantConnection, AssistantConnectionModel } from '@fob/shared/knowledge/contracts';
import { Plus, Trash } from '@/components/icons';
import { AppAlert } from '@/components/app-alert';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuSearch, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useTranslation } from '@/lib/i18n';
import { connectionDraft, connectionInput, hasConnectionChanges, validConnectionDraft, type ConnectionDraft } from './connection-state';
import type { AIConnectionsController } from './use-ai-connections';
import { aiSettingsMessages } from './messages';
import { ProtocolPicker } from './protocol-picker';
import styles from './ai-settings.module.css';

type TestResult = { model: string; latencyMs: number };

/** Drafts and secrets live only in this editor; changing service unmounts them. */
export function ConnectionEditor({ connection, controller, onCreated, onRemoved }: {
  connection?: AssistantConnection; controller: AIConnectionsController; onCreated(id: string): void; onRemoved(): void;
}) {
  const { t, locale } = useTranslation(aiSettingsMessages);
  const [draft, setDraft] = useState(() => connectionDraft(connection));
  const [saved, setSaved] = useState(connection);
  const [newModelId, setNewModelId] = useState(''), [newModelName, setNewModelName] = useState('');
  const [validation, setValidation] = useState<string | null>(null), [confirming, setConfirming] = useState(false);
  const [catalog, setCatalog] = useState<{ models: AssistantConnectionModel[]; truncated: boolean } | null>(null), [catalogOpen, setCatalogOpen] = useState(false), [search, setSearch] = useState('');
  const [tests, setTests] = useState<Record<string, TestResult>>({});
  const [discoveryFailed, setDiscoveryFailed] = useState(false);
  const active = useRef(false), discoveryPending = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const busy = Boolean(controller.busy), valid = validConnectionDraft(draft), dirty = hasConnectionChanges(draft, saved);
  function change(patch: Partial<ConnectionDraft>) { setDraft(current => ({ ...current, ...patch })); setValidation(null); if (patch.baseUrl !== undefined || patch.protocol !== undefined || patch.apiKey !== undefined) setTests({}); }
  async function save() {
    if (!valid) return null;
    if (!dirty && saved) return saved;
    const result = await controller.saveConnection(saved?.id ?? null, connectionInput(draft));
    if (result && active.current) {
      setSaved(result); setDraft(connectionDraft(result));
      if (!saved) onCreated(result.id);
    }
    return result;
  }
  async function test(modelId: string) {
    const target = await save();
    if (!target || !active.current) return;
    const result = await controller.testConnection(target.id, modelId);
    if (result && active.current) setTests(current => ({ ...current, [modelId]: result }));
  }
  async function discover() {
    if (discoveryPending.current || busy) return;
    discoveryPending.current = true; setCatalog(null); setDiscoveryFailed(false);
    let completed = false;
    try {
      const target = await save();
      if (!target || !active.current) return;
      const result = await controller.discoverModels(target.id);
      if (result && active.current) { setCatalog(result); completed = true; }
    } finally { discoveryPending.current = false; if (active.current && !completed) setDiscoveryFailed(true); }
  }
  function addModel() {
    const id = newModelId.trim(); if (!id) return;
    if (draft.models.some(model => model.id === id)) { setValidation(t('duplicateModel')); return; }
    if (draft.models.length >= 100) { setValidation(t('modelLimit')); return; }
    change({ models: [...draft.models, { id, name: newModelName.trim() }] }); setNewModelId(''); setNewModelName('');
  }
  const filtered = catalog?.models.filter(model => `${model.id} ${model.name}`.toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale)));
  return <form className={styles.editor} onSubmit={event => { event.preventDefault(); void save(); }}>
    <header className={styles.sectionHeader}><h3>{saved ? t('editConnection') : t('newConnection')}</h3>{saved && <Button type="button" variant="ghost" size="sm" className={styles.dangerButton} disabled={busy} onClick={() => setConfirming(true)}><Trash size={14} aria-hidden />{t('deleteConnection')}</Button>}</header>
    <div className={styles.fields}>
      <label className={styles.field}><span>{t('connectionName')}</span><input className={styles.control} name="fob-connection-name" value={draft.name} placeholder={t('connectionNamePlaceholder')} maxLength={80} required disabled={busy} onChange={event => change({ name: event.target.value })} /></label>
      <div className={styles.field}><span>{t('protocol')}</span><ProtocolPicker value={draft.protocol} disabled={busy} onChange={protocol => change({ protocol })} /></div>
      <label className={`${styles.field} ${styles.fullField}`}><span>{t('baseUrl')}</span><input className={styles.control} name="fob-connection-base-url" type="url" value={draft.baseUrl} placeholder="https://api.example.com/v1" maxLength={2048} required disabled={busy} spellCheck={false} onChange={event => change({ baseUrl: event.target.value })} /></label>
      <label className={`${styles.field} ${styles.fullField}`}><span>{t('apiKey')}</span><input className={styles.control} name="fob-connection-key" type="password" autoComplete="new-password" spellCheck={false} value={draft.apiKey} placeholder={saved?.hasCredential ? t('savedKey') : t('keyPlaceholder')} maxLength={8192} disabled={busy} onChange={event => change({ apiKey: event.target.value })} /><small className={styles.hint}>{t('keyHelp')}</small></label>
    </div>
    <section className={styles.models} aria-label={t('models')}>
      <header className={styles.sectionHeader}><h3>{t('models')} <span className={styles.count}>{draft.models.length}</span></h3>
        <DropdownMenu open={catalogOpen} onOpenChange={open => { setCatalogOpen(open); if (open) void discover(); else setSearch(''); }}>
          <DropdownMenuTrigger asChild><Button type="button" variant="outline" size="sm" aria-label={t('discoverModels')} disabled={busy || !valid} loading={controller.busy?.startsWith('discover:')}>{t(dirty ? 'saveDiscoverModels' : 'discoverModels')}</Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className={styles.discoveryMenu} onEscapeKeyDown={event => event.stopPropagation()}>
            <DropdownMenuSearch value={search} onValueChange={setSearch} placeholder={t('searchModels')} clearLabel={t('clearSearch')} />
            <div className={styles.menuOptions}>{!catalog ? discoveryFailed ? <div className={styles.menuEmpty}><p role="alert">{controller.error ?? t('failed')}</p><Button type="button" variant="ghost" size="sm" onClick={() => void discover()}>{t('retry')}</Button></div> : <p className={styles.menuEmpty} role="status">{t('discoveryLoading')}</p> : filtered?.length ? filtered.map(model => <DropdownMenuCheckboxItem key={model.id} checked={draft.models.some(item => item.id === model.id)} disabled={!draft.models.some(item => item.id === model.id) && draft.models.length >= 100} onSelect={event => event.preventDefault()} onCheckedChange={checked => change({ models: checked ? [...draft.models, model] : draft.models.filter(item => item.id !== model.id) })} className={styles.discoveredOption}>
              <span className={styles.optionCopy}><span>{model.name || model.id}</span>{model.name && <small>{model.id}</small>}</span>
            </DropdownMenuCheckboxItem>) : <p className={styles.menuEmpty}>{t(catalog.models.length ? 'noModelsFound' : 'discoverEmpty')}</p>}</div>
            {catalog?.truncated && <p className={styles.menuEmpty}>{t('discoverTruncated')}</p>}{draft.models.length >= 100 && <p className={styles.menuEmpty}>{t('modelLimit')}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      {draft.models.length ? <div className={styles.modelList}><div className={styles.modelLabels}><span>{t('modelId')}</span><span>{t('modelDisplayName')}</span></div>{draft.models.map(model => <div className={styles.modelRow} key={model.id}>
        <span className={styles.modelId} title={model.id}>{model.id}{tests[model.id] && <small className={styles.checked}>{tests[model.id].latencyMs} ms</small>}</span>
        <input className={styles.control} aria-label={`${t('modelDisplayName')} ${model.id}`} value={model.name} maxLength={200} placeholder={model.id} disabled={busy} onChange={event => change({ models: draft.models.map(item => item.id === model.id ? { ...item, name: event.target.value } : item) })} />
        <Button type="button" variant="ghost" size="sm" aria-label={`${t('testModel')} ${model.id}`} loading={controller.busy === `test:${model.id}`} disabled={busy || !valid} onClick={() => void test(model.id)}>{t('test')}</Button>
        <Button type="button" variant="ghost" size="icon-sm" className={styles.rowIcon} aria-label={`${t('removeModel')} ${model.id}`} disabled={busy} onClick={() => change({ models: draft.models.filter(item => item.id !== model.id) })}><Trash size={14} aria-hidden /></Button>
      </div>)}</div> : <p className={styles.hint}>{t('noModels')}</p>}
      <div className={styles.addModel}>
        <input className={styles.control} name="fob-new-model-id" aria-label={t('modelId')} value={newModelId} placeholder={t('modelId')} maxLength={200} disabled={busy || draft.models.length >= 100} onChange={event => { setNewModelId(event.target.value); setValidation(null); }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} />
        <input className={styles.control} name="fob-new-model-name" aria-label={t('modelDisplayName')} value={newModelName} placeholder={t('modelDisplayName')} maxLength={200} disabled={busy || draft.models.length >= 100} onChange={event => setNewModelName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addModel(); } }} />
        <Button type="button" variant="outline" size="icon-sm" className={styles.rowIcon} aria-label={t('addModel')} disabled={busy || !newModelId.trim() || draft.models.length >= 100} onClick={addModel}><Plus size={14} aria-hidden /></Button>
      </div>
      {validation && <p className={styles.validation} role="alert">{validation}</p>}
    </section>
    {confirming && saved && <AppAlert tone="warning" title={t('deleteConnectionConfirm', { name: saved.name })} action={<><Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>{t('cancel')}</Button><Button type="button" variant="outline" size="sm" loading={controller.busy === `remove:${saved.id}`} onClick={() => { void controller.removeConnection(saved).then(removed => { if (removed && active.current) onRemoved(); }); }}>{t('deleteConnection')}</Button></>} />}
    <footer className={styles.actions}>
      <Button type="button" variant="outline" size="sm" disabled={busy || !valid || !draft.models.length} loading={Boolean(controller.busy?.startsWith('test:'))} onClick={() => { const model = draft.models[0]; if (model) void test(model.id); }}>{t(dirty ? 'saveCheck' : 'check')}</Button>
      <span className={styles.spacer} /><Button type="submit" size="sm" loading={controller.busy === `save:${saved?.id ?? 'new'}`} disabled={busy || !valid || !dirty}>{t('save')}</Button>
    </footer>
  </form>;
}

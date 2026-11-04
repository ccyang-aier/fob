'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { SelectionCheck, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { useAppAlert } from '@/components/app-alert-provider';
import { useIdentity } from '@/features/identity/identity-context';
import { useTranslation } from '@/lib/i18n';
import type { KnowledgeBaseResources } from './data/knowledge-base-resources';
import type { KnowledgeBaseResource } from './knowledge-base';
import { KNOWLEDGE_BASE_AVATAR_PALETTES, KnowledgeBaseAvatar, resolveKnowledgeBaseAvatarPalette } from './knowledge-base-avatar';
import { saveKnowledgeBaseAvatarPalette, useKnowledgeBaseAvatarPalette } from './knowledge-base-avatar-preferences';
import { messages } from './knowledge-base-switcher.messages';
import common from './knowledge-base-switcher.module.css';
import styles from './knowledge-base-settings.module.css';

export function KnowledgeBaseSettings({ base, resources, onClose }: { base: KnowledgeBaseResource; resources: KnowledgeBaseResources; onClose(): void }) {
  const { t } = useTranslation(messages);
  const { notify } = useAppAlert();
  const { openSignIn } = useIdentity();
  const scope = `${resources.principal}:${base.source}:${base.id}`;
  const savedPalette = useKnowledgeBaseAvatarPalette(scope);
  const [palette, setPalette] = useState(() => resolveKnowledgeBaseAvatarPalette(base.id, savedPalette).id);
  const [name, setName] = useState(base.name);
  const [team, setTeam] = useState(base.source === 'server');
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null), id = useId(), pending = useRef(false);
  const canRename = resources.selectedKnowledgeBaseRole === 'owner';
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = dialog.current; node?.showModal();
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  async function save() {
    if (pending.current || !name.trim()) return;
    pending.current = true; setSaving(true); setFailure(false);
    try {
      const converting = team && base.source === 'local';
      const target = converting ? await resources.convertToTeam(base.id, name.trim()) : base;
      if (!target || (!converting && name.trim() !== base.name && !await resources.renameKnowledgeBase(base.id, name))) { setFailure(true); return; }
      try { saveKnowledgeBaseAvatarPalette(`${resources.principal}:${target.source}:${target.id}`, palette); }
      catch { notify('error', t('paletteFailed')); }
      notify('success', t(converting ? 'converted' : 'settingsSaved')); onClose();
    } finally { pending.current = false; setSaving(false); }
  }
  return <dialog ref={dialog} className={`${common.dialog} ${styles.dialog}`} aria-labelledby={id} onCancel={event => { event.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={event => { event.preventDefault(); void save(); }}>
      <header className={common.header}><h2 id={id}>{t('settings')}</h2><button type="button" className="fob-action" disabled={saving} aria-label={t('close')} onClick={onClose}><X size={16} /></button></header>
      <div className={`${common.body} ${styles.body}`}>
        <div className={styles.identity}><KnowledgeBaseAvatar seed={base.id} palette={palette} className={styles.avatar} /><label className={common.field}>{t('name')}<input type="text" value={name} disabled={saving || !canRename} maxLength={120} autoComplete="off" onChange={event => setName(event.target.value)} /></label></div>
        <fieldset className={styles.palettes} disabled={saving}><legend>{t('palette')}</legend><div className={styles.paletteGrid}>
          {KNOWLEDGE_BASE_AVATAR_PALETTES.map(option => <label key={option.id} className={`fob-action ${styles.palette}`} data-selected={palette === option.id}>
            <input type="radio" name="knowledge-palette" value={option.id} checked={palette === option.id} onChange={() => setPalette(option.id)} />
            <KnowledgeBaseAvatar seed={base.id} palette={option.id} preview className={styles.swatch} /><span>{t(option.id)}</span>{palette === option.id && <SelectionCheck className={styles.check} />}
          </label>)}
        </div></fieldset>
        <div className={styles.collaboration}>
          <div className={styles.teamRow}><div><label htmlFor={`${id}-team`}>{t('teamCollaboration')}</label><p id={`${id}-team-help`}>{t(base.source === 'server' ? 'teamLocked' : 'teamDescription')}</p></div>
            <button id={`${id}-team`} type="button" role="switch" aria-checked={team} aria-describedby={`${id}-team-help`} aria-label={t('teamCollaboration')} className={styles.toggle} disabled={saving || base.source === 'server'} onClick={() => setTeam(value => !value)}><span /></button>
          </div>
          {team && base.source === 'local' && <p className={styles.notice} role="status">{t('conversionNotice')}</p>}
          {base.source === 'local' && resources.principal === 'guest' && <Button type="button" size="sm" variant="outline" onClick={() => { onClose(); openSignIn(); }}>{t('conversionSignIn')}</Button>}
        </div>
        {failure && <span className={common.error} role="alert">{resources.error ?? t('failed')}</span>}
      </div>
      <footer className={common.footer}><Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" size="sm" loading={saving} disabled={!name.trim() || (team && base.source === 'local' && resources.principal === 'guest')}>{t(team && base.source === 'local' ? 'convertAndSave' : 'save')}</Button></footer>
    </form>
  </dialog>;
}

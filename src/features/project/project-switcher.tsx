'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { CaretUpDown, Check, FolderSimple, MagnifyingGlass, Palette, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react';
import { useAppAlert } from '@/components/app-alert-provider';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/lib/i18n';
import { useProjectResources, type ProjectResource } from './project-resources';
import { messages } from './i18n/project-switcher';
import styles from './project-switcher.module.css';
import { ProjectAvatar, PROJECT_AVATAR_PALETTES, resolveProjectAvatarPalette, type ProjectAvatarPalette } from './project-avatar';
import { useProjectAvatarPalette, saveProjectAvatarPalette } from './project-avatar-preferences';

type ProjectAction = { kind: 'create' } | { kind: 'rename' | 'remove'; project: ProjectResource };

export function ProjectSwitcher({ onSwitch }: { onSwitch: () => void }) {
  const { t } = useTranslation(messages);
  const { principal, scopeKey, projects, selectedProject, selectProject, status, error, refreshProjects } = useProjectResources();
  const selectedPalette = useProjectAvatarPalette(scopeKey);
  const activePalette = selectedProject ? resolveProjectAvatarPalette(selectedProject.id, selectedPalette).id : undefined;
  const { notify } = useAppAlert();
  function choosePalette(palette: ProjectAvatarPalette) {
    if (!scopeKey) return;
    try { saveProjectAvatarPalette(scopeKey, palette); } catch { notify('error', t('paletteFailed')); }
  }
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ProjectAction | null>(null);
  const filtered = projects.filter(project => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <DropdownMenu open={menuOpen} onOpenChange={open => { setMenuOpen(open); if (open) setQuery(''); }}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={`fob-action ${styles.trigger}`} aria-label={t('switch')}>
          {selectedProject ? <ProjectSwitcherAvatar project={selectedProject} principal={principal} /> : <span className={styles.avatar}><FolderSimple size={17} weight="duotone" /></span>}
          <span className={styles.name}>{selectedProject?.name ?? t(status === 'loading' ? 'loading' : 'select')}</span><CaretUpDown size={13} className={styles.chevrons} />
        </button>
      </DropdownMenuTrigger>
      {menuOpen && <DropdownMenuContent className={styles.menu} align="start" side="bottom" sideOffset={6} aria-label={t('switch')}>
        <div className={styles.search}><MagnifyingGlass size={15} /><input autoFocus value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); setMenuOpen(false); return; }
          e.stopPropagation();
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const items = e.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([data-disabled]), [role="menuitem"]:not([data-disabled])');
            items?.[e.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
          }
        }} aria-label={t('search')} placeholder={t('search')} /></div>
        <ScrollArea className={styles.list}>
          {filtered.map(project => <DropdownMenuItem key={`${project.source}:${project.id}`} className={styles.item} role="menuitemradio" aria-checked={selectedProject?.id === project.id} textValue={project.name} onSelect={() => { selectProject(project.id); if (selectedProject?.id !== project.id) onSwitch(); }}>
            <ProjectSwitcherAvatar project={project} principal={principal} />
            <span><strong>{project.name}</strong><small>{t(project.source)}</small></span>
            {selectedProject?.id === project.id && <Check size={15} />}
          </DropdownMenuItem>)}
          {!filtered.length && <p className={styles.status} role="status">{t(status === 'loading' ? 'loading' : query ? 'noResults' : 'empty')}</p>}
        </ScrollArea>
        {error && <DropdownMenuItem onSelect={e => { e.preventDefault(); void refreshProjects(); }}>{t('retry')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAction({ kind: 'create' })}><Plus size={16} />{t('create')}</DropdownMenuItem>
        {selectedProject && <>
          <DropdownMenuItem onSelect={() => setAction({ kind: 'rename', project: selectedProject })}><PencilSimple size={16} weight="duotone" />{t('rename')}</DropdownMenuItem>
          <DropdownMenuSub><DropdownMenuSubTrigger><Palette size={16} weight="duotone" />{t('palette')}</DropdownMenuSubTrigger><DropdownMenuSubContent>
            {PROJECT_AVATAR_PALETTES.map(palette => <DropdownMenuItem key={palette.id} role="menuitemradio" aria-checked={activePalette === palette.id} onSelect={() => choosePalette(palette.id)}><ProjectAvatar seed={selectedProject.id} palette={palette.id} preview className={styles.palettePreview} /><span>{t(palette.id)}</span>{activePalette === palette.id && <Check size={14} className="ml-auto" />}</DropdownMenuItem>)}
          </DropdownMenuSubContent></DropdownMenuSub>
          <DropdownMenuItem variant="destructive" onSelect={() => setAction({ kind: 'remove', project: selectedProject })}><Trash size={16} weight="duotone" />{t('remove')}</DropdownMenuItem>
        </>}
      </DropdownMenuContent>}
    </DropdownMenu>
    {action && <ProjectDialog action={action} onClose={() => setAction(null)} onChanged={onSwitch} />}
  </>;
}

function ProjectSwitcherAvatar({ project, principal }: { project: ProjectResource; principal: string }) {
  const palette = useProjectAvatarPalette(`${principal}:${project.source}:${project.id}`);
  return <ProjectAvatar seed={project.id} palette={palette} />;
}

function ProjectDialog({ action, onClose, onChanged }: { action: ProjectAction; onClose: () => void; onChanged: () => void }) {
  const { t } = useTranslation(messages);
  const { principal, selectedProject, createProject, renameProject, removeProject } = useProjectResources();
  const { notify } = useAppAlert();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(action.kind === 'create' ? '' : action.project.name);
  const [source, setSource] = useState<ProjectResource['source']>(selectedProject?.source ?? (principal === 'guest' ? 'local' : 'server'));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = ref.current;
    dialog?.showModal();
    dialog?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  async function save() {
    if (saving || (action.kind !== 'remove' && !name.trim())) return;
    setSaving(true);
    const ok = action.kind === 'create' ? await createProject(name, source) : action.kind === 'rename' ? await renameProject(action.project.id, name) : await removeProject(action.project.id);
    setSaving(false);
    if (!ok) { setError(true); return; }
    notify('success', t(action.kind === 'create' ? 'created' : action.kind === 'rename' ? 'renamed' : 'removed'));
    if (action.kind !== 'rename') onChanged();
    onClose();
  }
  return <dialog ref={ref} className={styles.dialog} aria-labelledby={titleId} onCancel={e => { e.preventDefault(); if (!saving) onClose(); }}>
    <form onSubmit={e => { e.preventDefault(); void save(); }}>
      <header className={styles.header}><h2 id={titleId}>{t(action.kind)}</h2><button type="button" className="fob-action" aria-label={t('close')} disabled={saving} onClick={onClose}><X size={16} /></button></header>
      <div className={styles.body}>
        {action.kind === 'remove' ? <p>{t('deleteDescription', { name: action.project.name })}</p> : <label className={styles.field}>{t('name')}<input type="text" value={name} disabled={saving} maxLength={120} onChange={e => setName(e.target.value)} placeholder={t('placeholder')} autoComplete="off" /></label>}
        {action.kind === 'create' && principal !== 'guest' && <fieldset className={styles.field} disabled={saving}><legend>{t('location')}</legend><div className={styles.sources}>{(['local', 'server'] as const).map(value => <label className={styles.source} key={value}><input type="radio" name="project-source" value={value} checked={source === value} onChange={() => setSource(value)} />{t(value)}</label>)}</div></fieldset>}
        {error && <span role="alert" className={styles.error}>{t('failed')}</span>}
      </div>
      <footer className={styles.footer}><Button type="button" variant="outline" size="sm" disabled={saving} onClick={onClose}>{t('cancel')}</Button><Button type="submit" variant={action.kind === 'remove' ? 'ghost' : 'default'} data-variant={action.kind === 'remove' ? 'destructive' : undefined} className={action.kind === 'remove' ? 'bg-[var(--danger-action-bg)] text-white' : undefined} size="sm" loading={saving} disabled={action.kind !== 'remove' && !name.trim()}>{t(action.kind === 'create' ? 'confirm' : action.kind === 'remove' ? 'remove' : 'save')}</Button></footer>
    </form>
  </dialog>;
}

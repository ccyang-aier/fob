'use client';

import { useState } from 'react';
import { BookOpenText, CaretUpDown, Check, MagnifyingGlass, Palette, PencilSimple, Plus, Trash } from '@/components/icons';
import { useAppAlert } from '@/components/app-alert-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeBaseResources } from './data/knowledge-base-resources';
import type { KnowledgeBaseResource } from './knowledge-base';
import { KnowledgeBaseDialog, type KnowledgeBaseAction } from './knowledge-base-dialog';
import { messages } from './knowledge-base-switcher.messages';
import { KnowledgeBaseAvatar, KNOWLEDGE_BASE_AVATAR_PALETTES, resolveKnowledgeBaseAvatarPalette, type KnowledgeBaseAvatarPalette } from './knowledge-base-avatar';
import { useKnowledgeBaseAvatarPalette, saveKnowledgeBaseAvatarPalette } from './knowledge-base-avatar-preferences';
import styles from './knowledge-base-switcher.module.css';

export function KnowledgeBaseSwitcher({ onSwitch = () => {} }: { onSwitch?: () => void }) {
  const { t } = useTranslation(messages);
  const resources = useKnowledgeBaseResources();
  const { knowledgeBases, selectedKnowledgeBase, selectedKnowledgeBaseRole, principal, scopeKey, selectKnowledgeBase, status, error, refreshKnowledgeBases, openCreateKnowledgeBase } = resources;
  const selectedPalette = useKnowledgeBaseAvatarPalette(scopeKey);
  const activePalette = selectedKnowledgeBase ? resolveKnowledgeBaseAvatarPalette(selectedKnowledgeBase.id, selectedPalette).id : undefined;
  const { notify } = useAppAlert();
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<KnowledgeBaseAction | null>(null);
  const filtered = knowledgeBases.filter(base => base.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  function choosePalette(palette: KnowledgeBaseAvatarPalette) {
    if (!scopeKey) return;
    try { saveKnowledgeBaseAvatarPalette(scopeKey, palette); } catch { notify('error', t('paletteFailed')); }
  }
  return <>
    <DropdownMenu open={menuOpen} onOpenChange={open => { setMenuOpen(open); if (open) setQuery(''); }}>
      <DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.trigger}`} aria-label={t('switch')}>
        {selectedKnowledgeBase ? <SwitcherAvatar base={selectedKnowledgeBase} principal={principal} /> : <span className={styles.avatar}><BookOpenText size={16} /></span>}
        <span className={styles.name}>{selectedKnowledgeBase?.name ?? t(status === 'loading' ? 'loading' : 'select')}</span><CaretUpDown size={14} className={styles.chevrons} />
      </button></DropdownMenuTrigger>
      {menuOpen && <DropdownMenuContent className={styles.menu} align="start" side="bottom" sideOffset={6} aria-label={t('switch')}>
        <div className={styles.search}><MagnifyingGlass size={14} /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => {
          if (event.key === 'Escape') { event.preventDefault(); setMenuOpen(false); return; }
          event.stopPropagation();
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); const items = event.currentTarget.closest('[role="menu"]')?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not([data-disabled]), [role="menuitem"]:not([data-disabled])');
            items?.[event.key === 'ArrowDown' ? 0 : items.length - 1]?.focus();
          }
        }} aria-label={t('search')} placeholder={t('search')} /></div>
        <ScrollArea className={styles.list}>{filtered.map(base => {
          const selected = selectedKnowledgeBase?.id === base.id && selectedKnowledgeBase.source === base.source;
          return <DropdownMenuItem key={`${base.source}:${base.id}`} className={styles.item} role="menuitemradio" aria-checked={selected} textValue={base.name} onSelect={() => { selectKnowledgeBase(base.id, { source: base.source }); if (!selected) onSwitch(); }}>
            <SwitcherAvatar base={base} principal={principal} /><span><strong>{base.name}</strong><small>{t(base.source)}</small></span>{selected && <Check size={14} />}
          </DropdownMenuItem>;
        })}{!filtered.length && <p className={styles.status} role="status">{t(status === 'loading' ? 'loading' : query ? 'noResults' : 'empty')}</p>}</ScrollArea>
        {error && <DropdownMenuItem onSelect={event => { event.preventDefault(); void refreshKnowledgeBases(); }}>{t('retry')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openCreateKnowledgeBase}><Plus size={16} />{t('create')}</DropdownMenuItem>
        {selectedKnowledgeBase && <>
          {selectedKnowledgeBaseRole === 'owner' && <DropdownMenuItem onSelect={() => setAction({ kind: 'rename', knowledgeBase: selectedKnowledgeBase })}><PencilSimple size={16} />{t('rename')}</DropdownMenuItem>}
          <DropdownMenuSub><DropdownMenuSubTrigger><Palette size={16} />{t('palette')}</DropdownMenuSubTrigger><DropdownMenuSubContent>
            {KNOWLEDGE_BASE_AVATAR_PALETTES.map(palette => <DropdownMenuItem key={palette.id} role="menuitemradio" aria-checked={activePalette === palette.id} onSelect={() => choosePalette(palette.id)}><KnowledgeBaseAvatar seed={selectedKnowledgeBase.id} palette={palette.id} preview className={styles.palettePreview} /><span>{t(palette.id)}</span>{activePalette === palette.id && <Check size={14} className="ml-auto" />}</DropdownMenuItem>)}
          </DropdownMenuSubContent></DropdownMenuSub>
          {selectedKnowledgeBaseRole === 'owner' && <DropdownMenuItem variant="destructive" onSelect={() => setAction({ kind: 'remove', knowledgeBase: selectedKnowledgeBase })}><Trash size={16} />{t('remove')}</DropdownMenuItem>}
        </>}
      </DropdownMenuContent>}
    </DropdownMenu>
    {action && <KnowledgeBaseDialog action={action} resources={resources} onClose={() => setAction(null)} onChanged={onSwitch} />}
  </>;
}

function SwitcherAvatar({ base, principal }: { base: KnowledgeBaseResource; principal: string }) {
  const palette = useKnowledgeBaseAvatarPalette(`${principal}:${base.source}:${base.id}`);
  return <KnowledgeBaseAvatar seed={base.id} palette={palette} />;
}

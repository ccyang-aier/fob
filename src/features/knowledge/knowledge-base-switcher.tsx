'use client';

import { useState } from 'react';
import { BookOpenText, CaretUpDown, SelectionCheck, GearSix, MagnifyingGlass, Plus, Trash } from '@/components/icons';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useTranslation } from '@/lib/i18n';
import { useKnowledgeBaseResources } from './data/knowledge-base-resources';
import type { KnowledgeBaseResource } from './knowledge-base';
import { KnowledgeBaseDialog, type KnowledgeBaseAction } from './knowledge-base-dialog';
import { messages } from './knowledge-base-switcher.messages';
import { messages as folderMessages } from './local/local-folder.messages';
import { KnowledgeBaseAvatar } from './knowledge-base-avatar';
import { useKnowledgeBaseAvatarPalette } from './knowledge-base-avatar-preferences';
import { KnowledgeBaseSettings } from './knowledge-base-settings';
import styles from './knowledge-base-switcher.module.css';

export function KnowledgeBaseSwitcher({ compact = false, onSwitch = () => {} }: { compact?: boolean; onSwitch?: () => void }) {
  const { t } = useTranslation(messages);
  const { t: folderT } = useTranslation(folderMessages);
  const resources = useKnowledgeBaseResources();
  const { knowledgeBases, selectedKnowledgeBase, selectedKnowledgeBaseRole, principal, selectKnowledgeBase, status, error, refreshKnowledgeBases, openCreateKnowledgeBase } = resources;
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<KnowledgeBaseAction | null>(null);
  const [settings, setSettings] = useState<KnowledgeBaseResource | null>(null);
  const filtered = knowledgeBases.filter(base => base.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <>
    <DropdownMenu open={menuOpen} onOpenChange={open => { setMenuOpen(open); if (open) setQuery(''); }}>
      <Tooltip>
        <TooltipTrigger asChild><DropdownMenuTrigger asChild><button type="button" className={`fob-action ${styles.trigger}`} data-compact={compact} aria-label={t('switch')}>
          {selectedKnowledgeBase ? <SwitcherAvatar base={selectedKnowledgeBase} principal={principal} /> : <span className={styles.avatar}><BookOpenText size={16} /></span>}
          {!compact && <><span className={styles.name}>{selectedKnowledgeBase?.name ?? t(status === 'loading' ? 'loading' : 'select')}</span><CaretUpDown size={14} className={styles.chevrons} /></>}
        </button></DropdownMenuTrigger></TooltipTrigger>
        <TooltipContent side={compact ? 'right' : 'bottom'}>{t('switch')}</TooltipContent>
      </Tooltip>
      {menuOpen && <DropdownMenuContent className={styles.menu} align="start" side={compact ? 'right' : 'bottom'} sideOffset={6} aria-label={t('switch')}>
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
            <SwitcherAvatar base={base} principal={principal} /><span><strong>{base.name}</strong><small>{t(base.source)}</small></span>{selected && <SelectionCheck />}
          </DropdownMenuItem>;
        })}{!filtered.length && <p className={styles.status} role="status">{t(status === 'loading' ? 'loading' : query ? 'noResults' : 'empty')}</p>}</ScrollArea>
        {error && <DropdownMenuItem onSelect={event => { event.preventDefault(); void refreshKnowledgeBases(); }}>{t('retry')}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={openCreateKnowledgeBase}><Plus size={16} />{t('create')}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => { void resources.openLocalKnowledgeBase().then(ok => { if (ok) onSwitch(); }); }}><BookOpenText size={16} />{folderT('open')}</DropdownMenuItem>
        {selectedKnowledgeBase && <>
          <DropdownMenuItem onSelect={() => setSettings(selectedKnowledgeBase)}><GearSix size={16} />{t('settings')}</DropdownMenuItem>
          {selectedKnowledgeBaseRole === 'owner' && <DropdownMenuItem variant="destructive" onSelect={() => setAction({ kind: 'remove', knowledgeBase: selectedKnowledgeBase })}><Trash size={16} />{t('remove')}</DropdownMenuItem>}
        </>}
      </DropdownMenuContent>}
    </DropdownMenu>
    {action && <KnowledgeBaseDialog action={action} resources={resources} onClose={() => setAction(null)} onChanged={onSwitch} />}
    {settings && <KnowledgeBaseSettings base={settings} resources={resources} onClose={() => setSettings(null)} />}
  </>;
}

function SwitcherAvatar({ base, principal }: { base: KnowledgeBaseResource; principal: string }) {
  const palette = useKnowledgeBaseAvatarPalette(`${principal}:${base.source}:${base.id}`);
  return <KnowledgeBaseAvatar seed={base.id} palette={palette} />;
}

/** The slash picker is only a view of the shared schema and browser block modules. */
import { Article } from '@phosphor-icons/react';
import { createKnowledgeRegistry } from '@fob/shared/knowledge/schema';
import type { BlockRegistry } from '@fob/shared/knowledge/schema';
import { editorBlockModuleByName } from '../block-modules';
import type { BlockIcon, BlockInsertCommand } from '../block-modules/types';
import { translate, getLocale, type Locale } from '@/lib/i18n';
import { blockLabels } from './block-labels.messages';

function blockTitle(name: string, suppliedTitle: string, locale: Locale = getLocale()) {
  // Product blocks have explicit catalogs; custom registry titles belong to their provider.
  return Object.hasOwn(blockLabels, name)
    ? translate(blockLabels, name as keyof typeof blockLabels, undefined, locale)
    : suppliedTitle;
}

export type SlashGroup = 'text' | 'layout' | 'media' | 'knowledge' | 'ai';
export type SlashItemIcon = BlockIcon;
export type SlashInsertCommand = BlockInsertCommand;

export interface SlashMenuItem {
  readonly name: string;
  readonly title: string;
  readonly keywords: readonly string[];
  readonly group: SlashGroup;
  readonly icon?: SlashItemIcon;
  readonly marker?: string;
  readonly shortcut?: string;
  run: SlashInsertCommand;
}

/** Additional product modules can replace a command without changing the shared schema. */
const registeredCommands = new Map<string, SlashInsertCommand>();
export function registerSlashInsert(name: string, run: SlashInsertCommand): void {
  registeredCommands.set(name, run);
}

const priority: Record<string, number> = {
  heading1: 0,
  heading: 1,
  heading3: 2,
  heading4: 3,
  taskList: 4,
  bulletList: 5,
  orderedList: 6,
  image: 7,
  video: 8,
  audio: 9,
  file: 10,
  paragraph: 11,
};

export function buildSlashItems(
  registry: BlockRegistry = createKnowledgeRegistry(),
): SlashMenuItem[] {
  const items = registry
    .getDefinitions()
    .filter((definition) => definition.slash)
    .flatMap((definition): SlashMenuItem[] => {
      const slash = definition.slash!;
      const blockModule = editorBlockModuleByName.get(definition.name);
      const base = { group: slash.group ?? 'text', icon: blockModule?.icon ?? Article };
      if (blockModule?.choices)
        return blockModule.choices.map((choice) => ({
          ...base,
          name: choice.name,
          get title() {
            return blockTitle(choice.name, choice.title);
          },
          keywords: [...slash.keywords, ...(choice.keywords ?? [])],
          marker: choice.marker,
          shortcut: choice.shortcut,
          run: registeredCommands.get(choice.name) ?? choice.insert,
        }));
      return [
        {
          ...base,
          name: definition.name,
          get title() {
            return blockTitle(definition.name, blockModule?.title ?? slash.title);
          },
          keywords: slash.keywords,
          shortcut: blockModule?.shortcut,
          run: registeredCommands.get(definition.name) ?? blockModule?.insert ?? (() => false),
        },
      ];
    });
  return items.sort((a, b) => (priority[a.name] ?? 100) - (priority[b.name] ?? 100));
}

export function filterSlashItems(
  items: readonly SlashMenuItem[],
  query: string,
  locale: Locale = getLocale(),
): SlashMenuItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...items];
  const ranked: { item: SlashMenuItem; rank: number }[] = [];
  for (const item of items) {
    const title = blockTitle(item.name, item.title, locale).toLowerCase();
    let rank: number;
    if (title.startsWith(needle)) rank = 0;
    else if (title.includes(needle)) rank = 1;
    else if (item.keywords.some((keyword) => keyword.toLowerCase().includes(needle))) rank = 2;
    else continue;
    ranked.push({ item, rank });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((entry) => entry.item);
}

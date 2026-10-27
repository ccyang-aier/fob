import catalog from './openmoji-catalog.json';

export const emojiGroups = catalog;
export type EmojiEntry = (typeof emojiGroups)[number]['items'][number];
export const emojiEntries: readonly EmojiEntry[] = emojiGroups.flatMap(group => group.items);
export const normalizeEmoji = (value: string) => value.replace(/\uFE0F/g, '');
const byEmoji = new Map(emojiEntries.map(entry => [normalizeEmoji(entry.emoji), entry]));
export const findEmoji = (value: string) => byEmoji.get(normalizeEmoji(value));

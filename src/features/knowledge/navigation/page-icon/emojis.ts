/** Fob's default 200-emoji OpenMoji catalog; persisted Unicode values are unchanged. */
import { emojiGroups } from '@/components/icons/emoji-catalog';

export const pageEmojiGroups = emojiGroups.map(group => ({
  label: group.label,
  items: group.items.map(entry => [entry.emoji, entry.name.zh, entry.name.en] as const),
}));
export const pageEmojis = pageEmojiGroups.flatMap(group => group.items);

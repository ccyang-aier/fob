import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { Emoji } from './emoji';
import { emojiGroups, emojiEntries, findEmoji } from './emoji-catalog';

test('the default picker exposes exactly 200 reviewed emoji in eight usable categories', () => {
  expect(emojiGroups).toHaveLength(8);
  expect(emojiGroups.every(group => group.items.length === 25)).toBe(true);
  expect(new Set(emojiEntries.map(entry => entry.hexcode)).size).toBe(200);
});

test('existing Unicode presentation variants resolve to the same local artwork without rewriting the value', () => {
  expect(findEmoji('❤')?.hexcode).toBe(findEmoji('❤️')?.hexcode);
  const html = renderToStaticMarkup(<Emoji value="❤️" size={24} />);
  expect(html).toContain('/icons/openmoji/2764.svg');
  expect(html).toContain('data-emoji="❤️"');
  expect(html).toContain('data-icon-library="openmoji"');
});

test('older emoji outside the curated library stay readable instead of becoming broken image requests', () => {
  const html = renderToStaticMarkup(<Emoji value="👍🏽" />);
  expect(html).toContain('👍🏽');
  expect(html).not.toContain('<img');
  expect(html).toContain('data-icon-library="native-emoji"');
});

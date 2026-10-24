import { createTranslator, formatDate, getLocale, type Locale } from '@/lib/i18n';
import { knowledgeMessages } from './author.messages';

/**
 * Authorship presentation of one suggestion (S02, design §4.5/§9.3/§9.5).
 *
 * S01 stores a raw `author` string on every mark/annotation. Humans and
 * agents share that one path, so the *display* has to derive kind, name and
 * source from the string alone — using the same origin grammar B08/B09
 * produce (`human:` `agent:{taskId}` `mcp:{clientName}:{taskId}`), with a
 * plain-name fallback for persons. Pure string work: no DOM, no editor.
 */

import { parseKnowledgeOrigin } from '@fob/shared/knowledge/collaboration';

const knowledgeT = createTranslator(knowledgeMessages);

export type SuggestionAuthorKind = 'human' | 'agent' | 'mcp' | 'restore';

export interface SuggestionAuthorBadge {
  kind: SuggestionAuthorKind;
  /** Display name: a person's name, the AI label, or the MCP client name. */
  label: string;
  /** Chip copy naming where the suggestion came from. */
  source: string;
  /** Task/checkpoint identifier of the machine source, if any. */
  detail: string | null;
}

function CHIP_TEXT(locale?: Locale): Record<SuggestionAuthorKind, string> {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  return { human: knowledgeT('human'), agent: knowledgeT('ai'), mcp: 'MCP', restore: 'CP' };
}

/** The one-to-three character glyph the in-text badge widget renders. */
export function authorBadgeGlyph(kind: SuggestionAuthorKind): string {
  return CHIP_TEXT()[kind];
}

/**
 * Maps a stored author string onto its badge. Unknown shapes stay honest:
 * anything unparseable is presented as a person carrying the raw string.
 */
export function describeSuggestionAuthor(author: string): SuggestionAuthorBadge {
  const origin = parseKnowledgeOrigin(author);
  if (origin?.kind === 'agent') {
    return {
      kind: 'agent',
      label: knowledgeT('aiAssistant'),
      source: knowledgeT('aiTask'),
      detail: origin.taskId,
    };
  }
  if (origin?.kind === 'mcp') {
    return {
      kind: 'mcp',
      label: origin.clientName,
      source: knowledgeT('mcpClient'),
      detail: origin.taskId,
    };
  }
  if (origin?.kind === 'restore') {
    return {
      kind: 'restore',
      label: knowledgeT('checkpointRestore'),
      source: knowledgeT('checkpoint'),
      detail: origin.checkpointId,
    };
  }
  if (origin?.kind === 'human') {
    // `human:{clientId}` names a session, not a person; the authenticated
    // name is not part of the mark, so the badge stays generic on purpose.
    return {
      kind: 'human',
      label: knowledgeT('members'),
      source: knowledgeT('yourInput'),
      detail: null,
    };
  }
  const user = /^user:(.+)$/.exec(author);
  if (user?.[1])
    return { kind: 'human', label: user[1], source: knowledgeT('yourInput'), detail: null };
  return {
    kind: 'human',
    label: author || knowledgeT('members'),
    source: knowledgeT('yourInput'),
    detail: null,
  };
}

/** Relative time with a date fallback; an unparseable value shows verbatim. */
export function formatSuggestionTime(
  createdAt: string,
  now: Date = new Date(),
  locale: Locale = getLocale(),
): string {
  const knowledgeT = createTranslator(knowledgeMessages, locale);
  const time = Date.parse(createdAt);
  if (Number.isNaN(time)) return createdAt;
  const elapsed = Math.max(0, now.getTime() - time);
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return knowledgeT('justNow');
  if (minutes < 60)
    return knowledgeT(minutes === 1 ? 'oneMinuteAgo' : 'valueMinutesAgo', { v0: minutes });
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return knowledgeT(hours === 1 ? 'oneHourAgo' : 'valueHoursAgo', { v0: hours });
  const days = Math.floor(hours / 24);
  if (days < 7) return knowledgeT(days === 1 ? 'oneDayAgo' : 'valueDaysAgo', { v0: days });
  const date = new Date(time);
  const sameYear = date.getFullYear() === now.getFullYear();
  const plain = formatDate(
    date,
    { ...(sameYear ? {} : { year: 'numeric' }), month: '2-digit', day: '2-digit' },
    locale,
  );
  return `${plain} ${formatDate(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }, locale)}`;
}

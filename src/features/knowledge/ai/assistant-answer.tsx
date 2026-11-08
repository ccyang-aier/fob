'use client';
import ReactMarkdown from 'react-markdown';
import type { AssistantSource } from '@fob/shared/knowledge/contracts';
import { useTranslation } from '@/lib/i18n';
import { assistantMessages } from './assistant.messages';

/** Markdown is text-only: no raw HTML, remote media, or unvalidated citations. */
export function AssistantAnswer({ text, sources, onSource }: { text: string; sources: readonly AssistantSource[]; onSource(source: AssistantSource): void }) {
  const { t } = useTranslation(assistantMessages);
  return <ReactMarkdown urlTransform={value => /^fob-source:\d+$/.test(value) || /^https?:\/\//.test(value) ? value : ''} components={{
    img: ({ alt }) => <span>{alt}</span>,
    a: ({ href, children }) => {
      if (href?.startsWith('fob-source:')) { const source = sources.find(source => source.id === Number(href.slice(11))); return source ? <button type="button" data-assistant-citation onClick={() => onSource(source)} title={source.title}>{children}</button> : <span title={t('sourceUnavailable')}>{children}</span>; }
      return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
  }}>{text}</ReactMarkdown>;
}

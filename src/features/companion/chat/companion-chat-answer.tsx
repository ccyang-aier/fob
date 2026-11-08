import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AssistantSource } from '@fob/shared/knowledge/contracts';

/** Only disclosed source IDs are interactive; remote images and raw HTML never render. */
export function CompanionChatAnswer({ text, sources, onSource, unavailableLabel }: { text: string; sources: readonly AssistantSource[]; onSource(source: AssistantSource): void; unavailableLabel: string }) {
  return <ReactMarkdown skipHtml remarkPlugins={[remarkGfm]} urlTransform={value => /^fob-source:\d+$/.test(value) || /^https?:\/\//i.test(value) ? value : ''} components={{
    img: ({ alt }) => <span>{alt}</span>,
    a: ({ href, children }) => {
      if (href?.startsWith('fob-source:')) {
        const source = sources.find(item => item.id === Number(href.slice(11)));
        return source ? <button type="button" data-companion-citation onClick={() => onSource(source)} title={source.title}>{children}</button> : <span title={unavailableLabel}>{children}</span>;
      }
      return href ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
    },
  }}>{text}</ReactMarkdown>;
}

export function citedCompanionSources(text: string, sources: readonly AssistantSource[]): readonly AssistantSource[] {
  const ids = new Set([...text.matchAll(/\[[^\]]+\]\(fob-source:(\d+)\)/g)].map(match => Number(match[1])));
  return sources.filter(source => ids.has(source.id));
}

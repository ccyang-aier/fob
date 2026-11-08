import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AssistantSource } from '@fob/shared/knowledge/contracts';
import { CompanionChatAnswer, citedCompanionSources } from './companion-chat-answer';

const source: AssistantSource = { id: 2, pageId: '10000000-0000-4000-8000-000000000002', blockId: 'intro', title: 'Private document', excerpt: 'A grounded excerpt' };
const render = (text: string) => renderToStaticMarkup(<CompanionChatAnswer text={text} sources={[source]} onSource={() => {}} unavailableLabel="Unavailable source" />);

test('renders only known source IDs as citation controls and lists only references actually used', () => {
  const text = 'A claim [2](fob-source:2), an unknown [9](fob-source:9), and [2](fob-source:2) again.';
  const html = render(text);
  expect(html.match(/data-companion-citation/g)).toHaveLength(2);
  expect(html).toContain('Unavailable source'); expect(html).not.toContain('href="fob-source:');
  expect(citedCompanionSources(text, [source])).toEqual([source]);
  expect(citedCompanionSources('Hello, no factual claims.', [source])).toEqual([]);
});

test('does not render scripts, raw HTML, remote image requests or unsafe protocols', () => {
  const html = render('<script>alert(1)</script>\n\n<img src="https://remote.test/track">\n\n![private image](https://remote.test/photo)\n\n[unsafe](javascript:alert%281%29)');
  expect(html).not.toContain('<script'); expect(html).not.toContain('<img'); expect(html).not.toContain('src='); expect(html).not.toContain('href="javascript:');
  expect(html).toContain('private image');
});

test('keeps safe external links separate from citations and gives them safe opener attributes', () => {
  const html = render('Read [the docs](https://example.com/docs).');
  expect(html).toContain('href="https://example.com/docs"'); expect(html).toContain('target="_blank"'); expect(html).toContain('rel="noopener noreferrer"');
  expect(html).not.toContain('data-companion-citation');
});

test('renders real GFM tables and keeps source validation inside table cells', () => {
  const html = render('| Owner | Evidence |\n| --- | --- |\n| Lin | [2](fob-source:2) |\n| Unknown | [9](fob-source:9) |');
  expect(html).toContain('<table>'); expect(html).toContain('<thead>'); expect(html).toContain('<th>Owner</th>'); expect(html).toContain('<td>Lin</td>');
  expect(html.match(/data-companion-citation/g)).toHaveLength(1); expect(html).toContain('Unavailable source'); expect(html).not.toContain('href="fob-source:');
});

test('renders GFM task lists as disabled checkboxes and supports strikethrough', () => {
  const html = render('- [x] ~~Draft~~\n- [ ] Review');
  expect(html).toContain('class="contains-task-list"'); expect(html.match(/class="task-list-item"/g)).toHaveLength(2);
  expect(html.match(/type="checkbox"/g)).toHaveLength(2); expect(html.match(/disabled=""/g)).toHaveLength(2);
  expect(html.match(/checked=""/g)).toHaveLength(1); expect(html).toContain('<del>Draft</del>'); expect(html).toContain('Review');
});

import { expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '@fob/shared/knowledge/schema';
import { createMarkdownPipeline } from '@fob/shared/knowledge/markdown';
import { exportDocumentMarkdown } from '../../../export/document-markdown-export';
import { buildSlashItems, filterSlashItems } from '../../../commands/slash-items';

test('the slash picker exposes PlantUML and its UML aliases', () => {
  const items = buildSlashItems();
  for (const query of ['plantuml', 'puml', '类图']) expect(filterSlashItems(items, query).some(item => item.name === 'plantuml')).toBe(true);
});
test('public Markdown export remains an editable PlantUML fence, including embedded backticks', () => {
  const source = '@startuml\nAlice -> Bob : <script> & ```\n@enduml';
  const document = schema.nodes.doc.create(null, [schema.nodes.plantuml.create({ source, title: 'PlantUML 验证' })]);
  const markdown = exportDocumentMarkdown(document, '文档标题');
  expect(markdown).toContain('````plantuml');
  const restored = createMarkdownPipeline().parse(markdown);
  expect(restored.lastChild?.type.name).toBe('plantuml');
  expect(restored.lastChild?.attrs.source).toBe(source);
});

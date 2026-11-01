import { describe, expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '../schema';
import { createMarkdownPipeline } from '../markdown';

const source = '@startuml\nactor "记录者" as Author\nAuthor -> Editor : 保存文档\nEditor --> Author : 已保存\n@enduml';

describe('PlantUML portable document block', () => {
  test('imports PlantUML fences and the puml alias into an editable diagram', () => {
    for (const language of ['plantuml', 'PlantUML', 'puml']) {
      const node = createMarkdownPipeline().parse(`\`\`\`${language}\n${source}\n\`\`\``).firstChild!;
      expect(node.type.name).toBe('plantuml');
      expect(node.attrs.source).toBe(source);
      expect(node.attrs.autoWidth).toBe(true);
      expect(node.attrs.autoHeight).toBe(true);
    }
  });
  test('keeps stable identity, annotations, source, title and both sizing modes through lossless Markdown', () => {
    const pipeline = createMarkdownPipeline();
    for (const automatic of [true, false]) {
      const doc = schema.nodes.doc.create(null, [schema.nodes.plantuml.create({
        source, title: '协作流程', blockId: 'plantuml-identity', sourceBlockId: 'source-identity',
        width: 65, height: 420, autoWidth: automatic, autoHeight: automatic,
      })]);
      doc.check();
      const markdown = pipeline.serialize(doc);
      expect(markdown).toContain('```plantuml');
      expect(pipeline.parse(markdown).toJSON()).toEqual(doc.toJSON());
    }
  });
  test('shared schema rejects oversized sources and invalid graphic attributes', () => {
    for (const attrs of [{ source: 'a'.repeat(50_001) }, { width: 101 }, { height: -1 }, { autoWidth: 'true' }, { autoHeight: null }]) {
      expect(() => schema.nodes.plantuml.create(attrs).check()).toThrow();
    }
    expect(() => schema.nodes.plantuml.create({ source, title: 'PlantUML' }).check()).not.toThrow();
  });
});

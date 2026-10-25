import { describe, expect, test } from 'bun:test';
import { knowledgeSchema as schema } from '../schema';
import { createMarkdownPipeline } from '../markdown';
import { isPdfSource, parseWhiteboardScene, resolveEmbedTarget, richContentUrl } from '.';

const scene = JSON.stringify({ elements: [{ id: 'shape', type: 'rectangle', x: 0, y: 0, width: 100, height: 60 }], appState: { viewBackgroundColor: '#ffffff' }, files: {} });

describe('rich content portable semantics', () => {
  test('uses the official Bilibili player with part, start time and no autoplay', () => {
    const target = resolveEmbedTarget('https://www.bilibili.com/video/BV1B7411m7LV/?p=3&t=90&autoplay=1')!;
    expect(target.provider).toBe('bilibili');
    const url = new URL(target.url);
    expect(url.origin).toBe('https://player.bilibili.com');
    expect(Object.fromEntries(url.searchParams)).toEqual({ bvid: 'BV1B7411m7LV', p: '3', t: '90', autoplay: '0', danmaku: '0' });
    expect(resolveEmbedTarget('https://www.bilibili.com/video/av123?p=2')?.provider).toBe('bilibili');
    expect(resolveEmbedTarget('https://bilibili.com.attacker.example/video/BV1B7411m7LV')?.provider).toBe('web');
  });
  test('keeps existing video providers and rejects unsafe and credential URLs', () => {
    expect(resolveEmbedTarget('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.url).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
    expect(resolveEmbedTarget('https://vimeo.com/123')?.url).toBe('https://player.vimeo.com/video/123');
    for (const url of ['javascript:alert(1)', 'data:text/html,test', 'https://user:password@example.com', 'file:///etc/passwd', '//example.com']) expect(richContentUrl(url)).toBeNull();
    expect(isPdfSource('asset:hash', 'application/pdf', 'report')).toBe(true);
    expect(isPdfSource('https://example.com/report.PDF?download=1')).toBe(true);
  });
  test('keeps rich block identity, metadata, PDF asset references and scene bytes through Markdown', () => {
    const doc = schema.nodes.doc.create(null, [
      schema.nodes.linkCard.create({ blockId: 'card', url: 'https://example.com/', title: 'Article', description: 'A & B', fetched: true }),
      schema.nodes.mermaid.create({ blockId: 'diagram', source: 'flowchart LR\n A --> B', height: 460 }),
      schema.nodes.pdf.create({ blockId: 'pdf', src: `asset:${'a'.repeat(64)}`, title: 'report.pdf' }),
      schema.nodes.embed.create({ blockId: 'video', url: 'https://www.bilibili.com/video/BV1B7411m7LV?p=2' }),
      schema.nodes.whiteboard.create({ blockId: 'board', title: 'Plan', scene, preview: 'data:image/png;base64,iVBORw0KGgo=' }),
    ]);
    const pipeline = createMarkdownPipeline();
    const markdown = pipeline.serialize(doc);
    expect(pipeline.parse(markdown).toJSON()).toEqual(doc.toJSON());
    expect(pipeline.parse('```mermaid\nflowchart LR\n A --> B\n```').firstChild?.type.name).toBe('mermaid');
    expect(pipeline.parse('```excalidraw\n' + scene + '\n```').firstChild?.attrs.scene).toBe(scene);
  });
  test('validates whiteboard input at the shared schema boundary', () => {
    expect(parseWhiteboardScene(scene)?.elements).toHaveLength(1);
    const invalid = [
      '{"elements":[],"appState":{},"files":{"x":{"id":"x","dataURL":"https://internal/image","mimeType":"image/png","created":1}}}',
      '{"elements":[{"id":"x","type":"iframe","x":0,"y":0,"width":1,"height":1}],"appState":{},"files":{}}',
      '{"elements":{},"appState":{},"files":{}}',
    ];
    for (const value of invalid) expect(() => schema.nodes.whiteboard.create({ scene: value }).check()).toThrow();
    expect(() => schema.nodes.mermaid.create({ height: -1 }).check()).toThrow();
    expect(() => schema.nodes.whiteboard.create({ preview: 'data:text/html;base64,PHNjcmlwdD4=' }).check()).toThrow();
  });
});

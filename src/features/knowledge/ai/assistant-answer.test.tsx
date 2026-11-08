import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AssistantAnswer } from './assistant-answer';
const source = { id:1,pageId:'10000000-0000-4000-8000-000000000001',blockId:'content',title:'项目计划',excerpt:'六月上线' };
test('only server-validated source numbers become reference controls', () => {
  const html=renderToStaticMarkup(<AssistantAnswer text={'**结论** [1](fob-source:1) [9](fob-source:9)'} sources={[source]} onSource={()=>{}} />);
  expect(html).toContain('<strong>结论</strong>');expect(html.match(/data-assistant-citation/g)).toHaveLength(1);expect(html).toContain('项目计划');
});
test('model output cannot inject HTML, executable links or remote images', () => {
  const html=renderToStaticMarkup(<AssistantAnswer text={'<script>alert(1)</script>\n\n[link](javascript:alert)\n\n![image](https://tracker.test/image.png)'} sources={[]} onSource={()=>{}} />);
  expect(html).not.toContain('<script>');expect(html).not.toContain('href="javascript:');expect(html).not.toContain('<img');expect(html).not.toContain('src="https://tracker.test');
});

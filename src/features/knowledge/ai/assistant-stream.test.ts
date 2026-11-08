import { expect, test } from 'bun:test';
import { consumeAssistantStream } from './assistant-api';
import { assistantTurnSchema } from '@fob/shared/knowledge/contracts';
import type { AssistantStreamEvent } from '@fob/shared/knowledge/contracts';
const id = '10000000-0000-4000-8000-000000000001';
const turn = assistantTurnSchema.parse({ id, pageId: id, question: '问题', answer: '中文回答', mode: 'document', status: 'done', sources: [], errorCode: null, createdAt: new Date().toISOString(), appliedPageId: null, model: 'test-model', inputTokens: 10, outputTokens: 2 });
function bytes(text: string, size = 1) { const raw = new TextEncoder().encode(text); return new ReadableStream<Uint8Array>({ start(controller) { for (let i=0;i<raw.length;i+=size) controller.enqueue(raw.slice(i,i+size)); controller.close(); } }); }
test('stream decoding preserves Chinese across byte boundaries and requires the durable terminal event', async () => {
  const output: AssistantStreamEvent[] = [];
  await consumeAssistantStream(bytes([JSON.stringify({ type:'delta', text:'中文回答' }),JSON.stringify({ type:'finish', turn })].join('\n')), event => output.push(event));
  expect(output).toHaveLength(2); expect(output[0]).toEqual({ type:'delta',text:'中文回答' });
  await expect(consumeAssistantStream(bytes(JSON.stringify({ type:'delta',text:'partial' })+'\n'),()=>{})).rejects.toMatchObject({ code:'interrupted' });
});
test('protocol failures are surfaced without fabricating a completed answer', async () => {
  await expect(consumeAssistantStream(bytes(JSON.stringify({ type:'error',code:'provider_auth' })+'\n'),()=>{})).rejects.toMatchObject({code:'provider_auth'});
  await expect(consumeAssistantStream(bytes(JSON.stringify({ type:'delta',text:45 })+'\n'),()=>{})).rejects.toThrow();
  await expect(consumeAssistantStream(bytes('x'.repeat(150001),160000),()=>{})).rejects.toMatchObject({ code:'invalid_response' });
});

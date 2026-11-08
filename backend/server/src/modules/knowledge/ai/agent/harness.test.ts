import { expect, test } from 'bun:test';
import type { GatewayStreamPart, ProposedToolCall } from '../gateway';
import { ModelGatewayError } from '../gateway';
import { runKnowledgeAgent } from './harness';
import { abortable, clipUtf8, utf8Bytes } from './budget';
import type { AgentModel, AgentModelRequest, AgentReadTool, AgentRunOptions } from './types';

const call = (name = 'read_page', id = 'call1'): ProposedToolCall => ({ id, name, input: { pageId: 'current' } });
const finish = (toolCalls: ProposedToolCall[] = [], finishReason = 'stop'): GatewayStreamPart => ({ type: 'finish', result: { callId: 'model-call', model: { source: 'platform', provider: 'test', model: 'test-model' }, toolCalls, finishReason, usage: { inputTokens: 10, outputTokens: 2 } } });
const read = (execute: AgentReadTool['execute']): AgentReadTool => ({ description: 'Authorized read', inputSchema: { type: 'object' }, execute });
function run(model: AgentModel, overrides: Partial<AgentRunOptions> = {}) {
  const text: string[] = [], steps: unknown[] = [], usages: unknown[] = [], checks: boolean[] = [];
  const options: AgentRunOptions = { model, system: 'Knowledge only', messages: [{ role: 'user', content: 'Question' }], tools: {}, signal: new AbortController().signal,
    check: async force => { checks.push(!!force); }, onText: async value => { text.push(value); }, onTool: async step => { steps.push(step); }, onUsage: (name, usage) => { usages.push({ name, ...usage }); }, ...overrides };
  return { result: runKnowledgeAgent(options), text, steps, usages, checks };
}

test('tool loop maps paired assistant/tool messages and accumulates real model usage', async () => {
  const requests: AgentModelRequest[] = [];
  let executions = 0;
  const model: AgentModel = { async *stream(request) {
    requests.push(request);
    if (requests.length === 1) { yield { type: 'tool-call', call: call() }; yield finish([call()]); }
    else { yield { type: 'text-delta', text: 'Verified answer.' }; yield finish(); }
  } };
  const state = run(model, { tools: { read_page: read(async () => { executions++; return { evidence: 'authorized' }; }) } });
  await state.result;
  expect(executions).toBe(1); expect(requests).toHaveLength(2); expect(state.text.join('')).toBe('Verified answer.');
  expect(requests[1]!.messages.at(-2)).toMatchObject({ role: 'assistant', content: [{ type: 'tool-call', toolName: 'read_page', toolCallId: 'call1' }] });
  expect(requests[1]!.messages.at(-1)).toMatchObject({ role: 'tool', content: [{ type: 'tool-result', toolCallId: 'call1', output: { type: 'json', value: { evidence: 'authorized' } } }] });
  expect(state.steps).toMatchObject([{ status: 'running', name: 'read_page' }, { status: 'done', name: 'read_page' }]);
  expect(state.usages.at(-1)).toEqual({ name: 'test-model', inputTokens: 20, outputTokens: 4 });
  expect(state.checks.filter(Boolean).length).toBeGreaterThanOrEqual(6);
});

test('last step is tool-free; incomplete arguments and unknown write tools never execute', async () => {
  const requests: AgentModelRequest[] = []; let executions = 0;
  const model: AgentModel = { async *stream(request) {
    requests.push(request);
    if (requests.length === 1) {
      yield finish([call('read_page', 'incomplete'), call('delete_page', 'forbidden')], 'length');
    } else { yield { type: 'text-delta', text: 'More evidence is needed.' }; yield finish(); }
  } };
  const state = run(model, { tools: { read_page: read(async () => { executions++; return {}; }) }, limits: { modelSteps: 2 } });
  await state.result;
  expect(executions).toBe(0); expect(requests[1]!.tools).toBeUndefined();
  expect(JSON.stringify(requests[1]!.messages)).toContain('incomplete_tool_arguments');
  expect(JSON.stringify(requests[1]!.messages)).toContain('unknown_tool');
});

test('access change after a read prevents tool results or another model request', async () => {
  let revoked = false, requests = 0;
  const state = run({ async *stream() { requests++; yield finish([call()]); } }, {
    tools: { read_page: read(async () => { revoked = true; return { secret: 'must not reach the model' }; }) },
    check: async () => { if (revoked) throw new Error('access_changed'); },
  });
  await expect(state.result).rejects.toThrow('access_changed');
  expect(requests).toBe(1); expect(state.steps).toHaveLength(1); expect(state.text).toEqual([]);
});

test('cancellation interrupts a non-cooperating tool and stops later tools', async () => {
  const controller = new AbortController(); let executions = 0;
  const state = run({ async *stream() { yield finish([call(), call('read_page', 'second')]); } }, {
    signal: controller.signal,
    tools: { read_page: read(async () => { executions++; controller.abort(); return new Promise(() => {}); }) },
  });
  await expect(state.result).rejects.toThrow();
  expect(executions).toBe(1);
});

test('tool timeouts are returned as safe errors, allowing the model to explain limits', async () => {
  let requests = 0;
  const state = run({ async *stream(request) {
    requests++;
    if (requests === 1) yield finish([call()]);
    else { expect(JSON.stringify(request.messages)).toContain('tool_timeout'); yield { type: 'text-delta', text: 'The read timed out.' }; yield finish(); }
  } }, { tools: { read_page: read(async () => new Promise(() => {})) }, limits: { toolTimeoutMs: 10 } });
  await state.result; expect(requests).toBe(2);
});

test('transient failures retry once before output; partial output is never replayed', async () => {
  let attempts = 0;
  const first = run({ async *stream() { attempts++; if (attempts === 1) throw new ModelGatewayError('rate_limited', true); yield { type: 'text-delta', text: 'Recovered' }; yield finish(); } });
  await first.result; expect(attempts).toBe(2);
  attempts = 0;
  const partial = run({ async *stream() { attempts++; yield { type: 'text-delta', text: 'Partial' }; throw new ModelGatewayError('provider_unavailable', true); } });
  await expect(partial.result).rejects.toThrow('provider_unavailable'); expect(attempts).toBe(1); expect(partial.text).toEqual(['Partial']);
});

test('whole-run deadline and context budget stop work without model/tool side effects', async () => {
  const state = run({ async *stream() { await new Promise(() => {}); yield finish(); } }, { limits: { timeoutMs: 10 } });
  await expect(state.result).rejects.toThrow('timeout');
  let requested = false;
  const bounded = run({ async *stream() { requested = true; yield finish(); } }, { limits: { transcriptBytes: 1 } });
  await expect(bounded.result).rejects.toThrow('response_too_large'); expect(requested).toBe(false);
});

test('byte clipping preserves Unicode and abort wrappers consume already-rejected work', async () => {
  const clipped = clipUtf8('甲😀乙', 6); expect(clipped).toBe('甲'); expect(utf8Bytes(clipped)).toBeLessThanOrEqual(6);
  const controller = new AbortController(); controller.abort();
  await expect(abortable(Promise.reject(new Error('already failed')), controller.signal)).rejects.toThrow();
});

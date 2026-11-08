import { randomUUID } from 'node:crypto';
import type { ModelMessage } from 'ai';
import { ModelGatewayError } from '../gateway';
import type { GatewayTool, ModelUsage, ProposedToolCall } from '../gateway';
import { abortable, agentLimits, utf8Bytes } from './budget';
import type { AgentRunOptions } from './types';

function addUsage(total: ModelUsage | null, next: ModelUsage): ModelUsage {
  if (!total) return { ...next };
  return {
    inputTokens: total.inputTokens === null || next.inputTokens === null ? null : total.inputTokens + next.inputTokens,
    outputTokens: total.outputTokens === null || next.outputTokens === null ? null : total.outputTokens + next.outputTokens,
  };
}

/**
 * Knowledge-specific counterpart to Pi's stream → validated tools → tool results
 * loop. Sequential execution makes permission changes and cancellation fences
 * deterministic. The harness has no database, credentials, shell, or write API.
 */
export async function runKnowledgeAgent(options: AgentRunOptions): Promise<void> {
  const limits = { ...agentLimits, ...options.limits };
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new ModelGatewayError('timeout')), limits.timeoutMs);
  timer.unref?.();
  const signal = AbortSignal.any([options.signal, deadline.signal]);
  const messages: ModelMessage[] = [...options.messages];
  const declarations: Record<string, GatewayTool> = Object.fromEntries(Object.entries(options.tools).map(([name, tool]) => [name, { description: tool.description, inputSchema: tool.inputSchema }]));
  const fingerprints = new Map<string, number>();
  let executed = 0, emittedCharacters = 0, usage: ModelUsage | null = null;
  const check = async (force = false) => { signal.throwIfAborted(); await abortable(options.check(force), signal); signal.throwIfAborted(); };
  const emitText = async (text: string) => {
    if (!text) return;
    if (emittedCharacters + text.length > agentLimits.answerCharacters) throw new ModelGatewayError('response_too_large');
    emittedCharacters += text.length;
    await abortable(options.onText(text), signal);
  };
  try {
    for (let step = 0; step < limits.modelSteps; step++) {
      await check(true);
      if (utf8Bytes(messages) + utf8Bytes(options.system) > limits.transcriptBytes) throw new ModelGatewayError('response_too_large');
      // Reserve a final tool-free step to synthesize what was actually obtained.
      const canCall = step < limits.modelSteps - 1 && executed < limits.toolCalls;
      let text = '', finish: Extract<import('../gateway').GatewayStreamPart, { type: 'finish' }> | undefined;
      const calls = new Map<string, ProposedToolCall>();
      let beganOutput = false;
      for (let attempt = 0; ; attempt++) {
        try {
          const stream = options.model.stream({ system: options.system, messages: [...messages],
            ...(canCall && Object.keys(declarations).length ? { tools: declarations } : {}), signal,
            timeoutMs: Math.max(1_000, Math.min(90_000, limits.timeoutMs)) });
          const iterator = stream[Symbol.asyncIterator]();
          try {
            while (true) {
              const item = await abortable(iterator.next(), signal);
              if (item.done) break;
              await check();
              const part = item.value;
              if (part.type === 'text-delta') {
                beganOutput = true;
                if (!text && emittedCharacters) await emitText('\n\n');
                text += part.text;
                await emitText(part.text);
              } else if (part.type === 'tool-call') {
                beganOutput = true;
                if (calls.has(part.call.id)) throw new ModelGatewayError('invalid_response');
                calls.set(part.call.id, part.call);
              } else {
                finish = part;
                for (const call of part.result.toolCalls) if (!calls.has(call.id)) calls.set(call.id, call);
              }
              if (calls.size > limits.toolCalls) throw new ModelGatewayError('response_too_large');
            }
          } finally {
            // SDK streams honor AbortSignal. Do not await an uncooperative
            // iterator's return() after cancellation, or the timeout is lost.
            const closing = iterator.return?.();
            if (closing) { if (signal.aborted) void closing.catch(() => {}); else await abortable(closing, signal); }
          }
          break;
        } catch (error) {
          // Only one retry before any externally visible output or tool proposal.
          // Partial responses and tools are never replayed automatically.
          if (attempt || beganOutput || signal.aborted || !(error instanceof ModelGatewayError) || !error.retryable || !['provider_unavailable', 'rate_limited'].includes(error.code)) throw error;
          await check(true);
        }
      }
      if (!finish) throw new ModelGatewayError('invalid_response');
      usage = addUsage(usage, finish.result.usage);
      options.onUsage(finish.result.model.model, usage);
      if (!calls.size) {
        if (!text.trim()) throw new ModelGatewayError('invalid_response');
        await check(true);
        return;
      }
      if (!canCall) throw new ModelGatewayError('invalid_response');
      const proposals = [...calls.values()];
      if (executed + proposals.length > limits.toolCalls) throw new ModelGatewayError('response_too_large');
      messages.push({ role: 'assistant', content: [
        ...(text ? [{ type: 'text' as const, text }] : []),
        ...proposals.map(call => ({ type: 'tool-call' as const, toolCallId: call.id, toolName: call.name, input: call.input })),
      ] });
      for (const call of proposals) {
        await check(true);
        executed++;
        const tool = Object.hasOwn(options.tools, call.name) ? options.tools[call.name] : undefined;
        const id = randomUUID(), started = performance.now();
        const name = Object.hasOwn(options.tools, call.name) ? call.name : 'unknown_tool';
        await abortable(options.onTool({ id, name, status: 'running', summary: '正在读取授权资料', durationMs: null }), signal);
        let output: unknown, failed = false;
        const fingerprint = `${call.name}:${JSON.stringify(call.input)}`;
        const repeats = (fingerprints.get(fingerprint) ?? 0) + 1;
        fingerprints.set(fingerprint, repeats);
        const toolDeadline = new AbortController();
        const toolTimer = setTimeout(() => toolDeadline.abort(new ModelGatewayError('timeout')), limits.toolTimeoutMs);
        toolTimer.unref?.();
        const toolSignal = AbortSignal.any([signal, toolDeadline.signal]);
        try {
          if (!tool || repeats > 2 || finish.result.finishReason === 'length') {
            failed = true;
            output = { error: !tool ? 'unknown_tool' : repeats > 2 ? 'repeated_tool_call' : 'incomplete_tool_arguments' };
          } else {
            output = await abortable(tool.execute(call.input, toolSignal), toolSignal);
            await check(true);
            if (utf8Bytes(output) > agentLimits.toolResultBytes) throw new ModelGatewayError('response_too_large');
          }
        } catch (error) {
          // Permission/cancellation failures stop the whole run. Ordinary schema
          // or inaccessible-target failures may be corrected by the next step.
          signal.throwIfAborted();
          await check(true);
          if (error instanceof ModelGatewayError && error.code !== 'timeout') throw error;
          failed = true;
          const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
          output = { error: toolDeadline.signal.aborted ? 'tool_timeout' : ['INVALID_TOOL_INPUT', 'INVALID_TOOL_RANGE', 'INVALID_TOOL_QUERY'].includes(code) ? 'invalid_tool_input' : 'tool_unavailable' };
        } finally { clearTimeout(toolTimer); }
        await check(true);
        await abortable(options.onTool({ id, name, status: failed ? 'failed' : 'done', summary: failed ? '本次读取未完成' : '已读取授权资料', durationMs: Math.max(0, Math.round(performance.now() - started)) }), signal);
        messages.push({ role: 'tool', content: [{ type: 'tool-result', toolCallId: call.id, toolName: call.name,
          output: { type: 'json', value: JSON.parse(JSON.stringify(output ?? null)) } }] });
      }
    }
    throw new ModelGatewayError('invalid_response');
  } finally { clearTimeout(timer); }
}
